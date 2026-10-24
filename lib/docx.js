/**
 * DOCX (OOXML / WordprocessingML) writer and reader for the Novel Studio host.
 *
 * Writing produces a complete, valid Word package with:
 *   - A4 page geometry (11906 x 16838 twips), 1440 twip top/bottom margins,
 *     1247 twip left/right margins
 *   - body text in Song/SimSun 14pt (w:sz 28), first-line indent of 2
 *     characters (w:ind w:firstLine="560"), 1.5 line spacing
 *     (w:spacing w:line="360" w:lineRule="auto")
 *   - chapter headings using the Heading1 style, centered and bold
 *   - an explicit page break between chapters (unless pageBreak === false)
 *   - a footer with a PAGE field
 *   - optional cover image (PNG or JPEG) as the first block
 *
 * Only Node builtins are used; ZIP packing lives in ./zip.js.
 */

import { zipSync, unzipSync } from './zip.js';

// 14pt body (w:sz is half-points) — 12pt reads as a compact print face at A4,
// but most Chinese literary journals want 小四 / 四号, and a larger face also
// fills the page so the manuscript does not look sparse.
const BODY_SIZE = 28;
// Two characters of first-line indent, in twips: 1 char = font size, 1pt = 20 twips.
const BODY_INDENT = 560;
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN_TB = 1440;
const MARGIN_LR = 1247;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const NS_CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_DCTERMS = 'http://purl.org/dc/terms/';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const NS_EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const NS_VT = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */
/* ------------------------------------------------------------------ */

export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 forbids most control characters; dropping them keeps the file valid.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function decodeXml(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function isoDate(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function paraXml(text, opts) {
  const {
    style = null,
    align = null,
    indent = false,
    spacing = null,
    bold = false,
    pageBreakBefore = false,
  } = opts ?? {};

  const pPr = [];
  if (pageBreakBefore) pPr.push('<w:pageBreakBefore/>');
  if (style) pPr.push(`<w:pStyle w:val="${escapeXml(style)}"/>`);
  if (spacing) pPr.push(`<w:spacing w:line="${spacing.line}" w:lineRule="auto"/>`);
  if (indent) pPr.push(`<w:ind w:firstLine="${BODY_INDENT}" w:firstLineChars="200"/>`);
  if (align) pPr.push(`<w:jc w:val="${align}"/>`);
  const pPrXml = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';

  const rPr = [
    '<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/>',
    bold ? '<w:b/><w:bCs/>' : '',
    `<w:sz w:val="${BODY_SIZE}"/><w:szCs w:val="${BODY_SIZE}"/>`,
  ].join('');
  const runs = String(text ?? '')
    .split('\t')
    .map((chunk, index) => {
      const parts = [];
      if (index > 0) parts.push('<w:tab/>');
      if (chunk.length > 0) parts.push(`<w:t xml:space="preserve">${escapeXml(chunk)}</w:t>`);
      return `<w:r><w:rPr>${rPr}</w:rPr>${parts.join('')}</w:r>`;
    })
    .join('');

  return `<w:p>${pPrXml}${runs}</w:p>`;
}

/* ------------------------------------------------------------------ */
/* package parts                                                       */
/* ------------------------------------------------------------------ */

function contentTypesXml(hasCover, coverExt, hasHeader) {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ];
  if (hasCover && coverExt) {
    defaults.push(
      `<Default Extension="${coverExt}" ContentType="image/${coverExt === 'jpg' ? 'jpeg' : coverExt}"/>`,
    );
  }
  const overrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];
  if (hasHeader) {
    overrides.splice(
      4,
      0,
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    );
  }
  return `${XML_DECL}<Types xmlns="${NS_CT}">${defaults.join('')}${overrides.join('')}</Types>`;
}

function rootRelsXml() {
  return (
    `${XML_DECL}<Relationships xmlns="${NS_PKG_RELS}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>'
  );
}

function documentRelsXml(hasCover, hasHeader) {
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
  ];
  if (hasHeader) {
    rels.push(
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdHeaderBlank" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>',
    );
  }
  if (hasCover) {
    rels.push(
      '<Relationship Id="rIdCover" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.png"/>',
    );
  }
  return `${XML_DECL}<Relationships xmlns="${NS_PKG_RELS}">${rels.join('')}</Relationships>`;
}

function stylesXml() {
  const headingBase = (id, name, outline) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="240" w:line="360" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="${outline}"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="黑体" w:hAnsi="黑体" w:eastAsia="黑体" w:cs="黑体"/><w:b/><w:bCs/><w:sz w:val="${id === 'Heading1' ? 36 : 32}"/><w:szCs w:val="${id === 'Heading1' ? 36 : 32}"/></w:rPr></w:style>`;

  return (
    `${XML_DECL}<w:styles xmlns:w="${NS_W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/>' +
    `<w:sz w:val="${BODY_SIZE}"/><w:szCs w:val="${BODY_SIZE}"/>` +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' +
    `<w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="${BODY_INDENT}" w:firstLineChars="200"/><w:jc w:val="both"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/><w:sz w:val="${BODY_SIZE}"/><w:szCs w:val="${BODY_SIZE}"/></w:rPr></w:style>` +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:before="240" w:after="360" w:line="360" w:lineRule="auto"/><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="黑体" w:hAnsi="黑体" w:eastAsia="黑体" w:cs="黑体"/><w:b/><w:bCs/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="240" w:line="360" w:lineRule="auto"/><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="楷体" w:hAnsi="楷体" w:eastAsia="楷体" w:cs="楷体"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    headingBase('Heading1', 'heading 1', 0) +
    headingBase('Heading2', 'heading 2', 1) +
    headingBase('Heading3', 'heading 3', 2) +
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '</w:styles>'
  );
}

function settingsXml() {
  return (
    `${XML_DECL}<w:settings xmlns:w="${NS_W}">` +
    '<w:zoom w:percent="100"/>' +
    '<w:defaultTabStop w:val="420"/>' +
    '<w:characterSpacingControl w:val="compressPunctuation"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '<w:themeFontLang w:val="en-US" w:eastAsia="zh-CN"/>' +
    '</w:settings>'
  );
}

function footerXml() {
  return (
    `${XML_DECL}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">第 </w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> 页</w:t></w:r>' +
    '</w:p></w:ftr>'
  );
}

/**
 * Running header used by manuscript mode (R10 ⑤): the page carries the title and
 * the author, so a printed or re-folded stack of pages can never lose track of
 * which submission it belongs to.
 */
function headerXml({ title, author }) {
  const head = String(title ?? '');
  const by = String(author ?? '');
  const left = [head, by ? `作者：${by}` : ''].filter(Boolean).join('　·　');
  return (
    `${XML_DECL}<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="right"/></w:pPr>' +
    `<w:r><w:rPr><w:rFonts w:ascii="楷体" w:hAnsi="楷体" w:eastAsia="楷体" w:cs="楷体"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="595959"/></w:rPr><w:t xml:space="preserve">${escapeXml(left)}</w:t></w:r>` +
    '</w:p></w:hdr>'
  );
}

function blankHeaderXml() {
  // Deliberately empty: `titlePg` requires a first-page header part to exist,
  // and an empty paragraph is the only way to say "print nothing here".
  return `${XML_DECL}<w:hdr xmlns:w="${NS_W}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p></w:hdr>`;
}

function sectPrXml(hasHeader) {
  return (
    '<w:sectPr>' +
    // R20: page one must NOT carry the running header. The body already opens
    // with the title and author block, so a header there printed the same two
    // lines twice on the first page — the duplication the author reported as
    // 「题目重复」. `titlePg` switches the section to a distinct first page and
    // points it at a blank header, so the running header starts on page two,
    // where it is actually needed to keep loose sheets identifiable.
    (hasHeader ? '<w:titlePg/>' : '') +
    (hasHeader ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : '') +
    (hasHeader ? '<w:headerReference w:type="first" r:id="rIdHeaderBlank"/>' : '') +
    '<w:footerReference w:type="default" r:id="rIdFooter1"/>' +
    // Reusing the same footer relationship for the first page keeps the page
    // number on page one; only the header differs.
    (hasHeader ? '<w:footerReference w:type="first" r:id="rIdFooter1"/>' : '') +
    `<w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/>` +
    `<w:pgMar w:top="${MARGIN_TB}" w:right="${MARGIN_LR}" w:bottom="${MARGIN_TB}" w:left="${MARGIN_LR}" w:header="720" w:footer="720" w:gutter="0"/>` +
    '<w:cols w:space="425"/>' +
    '<w:docGrid w:type="lines" w:linePitch="312"/>' +
    '</w:sectPr>'
  );
}

function coreXml({ title, author, created, subject, description }) {
  const createdIso = isoDate(created);
  return (
    `${XML_DECL}<cp:coreProperties xmlns:cp="${NS_CP}" xmlns:dc="${NS_DC}" xmlns:dcterms="${NS_DCTERMS}" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="${NS_XSI}">` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dc:creator>${escapeXml(author)}</dc:creator>` +
    `<dc:subject>${escapeXml(subject || '')}</dc:subject>` +
    `<dc:description>${escapeXml(description || '')}</dc:description>` +
    `<cp:lastModifiedBy>${escapeXml(author)}</cp:lastModifiedBy>` +
    '<cp:revision>1</cp:revision>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

function appXml() {
  return (
    `${XML_DECL}<Properties xmlns="${NS_EP}" xmlns:vt="${NS_VT}">` +
    '<Application>Novel Writer</Application>' +
    '<DocSecurity>0</DocSecurity>' +
    '<ScaleCrop>false</ScaleCrop>' +
    '<Company></Company>' +
    '<LinksUpToDate>false</LinksUpToDate>' +
    '<SharedDoc>false</SharedDoc>' +
    '<HyperlinksChanged>false</HyperlinksChanged>' +
    '<AppVersion>16.0000</AppVersion>' +
    '</Properties>'
  );
}

function detectImageKind(base64) {
  const head = String(base64 || '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'png';
  if (head.startsWith('R0lGOD')) return 'gif';
  return null;
}

function imageExtFor(kind) {
  return kind === 'jpeg' ? 'jpg' : kind;
}

function coverParagraphXml(coverBase64, kind, emuWidth, emuHeight) {
  const rId = 'rIdCover';
  const docPrId = 1;
  const name = 'Cover Image';
  return (
    '<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<wp:extent cx="${emuWidth}" cy="${emuHeight}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${docPrId}" name="${escapeXml(name)}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapeXml(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuWidth}" cy="${emuHeight}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

/* ------------------------------------------------------------------ */
/* building                                                            */
/* ------------------------------------------------------------------ */

/**
 * Assemble a Word document from chapters.
 *
 * @param {object} input
 * @param {string} [input.title]
 * @param {string} [input.author]
 * @param {Array<{title?: string, content?: string, level?: number}>} [input.chapters]
 * @param {object} [input.options]
 * @param {string} [input.options.coverBase64] PNG/JPEG/JPEG base64 (no data: prefix needed)
 * @param {boolean} [input.options.pageBreak=true] page break before every chapter but the first
 * @param {boolean} [input.options.includeToc] accepted for API symmetry; the docx has no TOC field
 * @param {Date|string} [input.options.created]
 * @param {string} [input.options.appendText] extra copy appended after the last chapter
 * @param {boolean} [input.options.manuscript] R10 ⑤: manuscript layout for editors
 *        (running header with title+author, wider margins, roomier leading)
 * @returns {Buffer}
 */
export function buildDocx({ title = '', author = '', chapters = [], options = {} } = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const pageBreak = opts.pageBreak !== false;
  const created = opts.created ? new Date(opts.created) : new Date();
  const coverBase64 = typeof opts.coverBase64 === 'string' ? opts.coverBase64.replace(/^data:[^;]+;base64,/, '') : '';
  const coverKind = coverBase64 ? detectImageKind(coverBase64) : null;
  const hasCover = Boolean(coverKind);
  // R10 ⑤: an editor reads a manuscript, not a webpage. Manuscript mode adds a
  // running header (so loose pages stay identifiable) and a slightly roomier
  // page, which is what submission guidelines assume when they say 「按 A4 排版」.
  const hasHeader = opts.manuscript === true && Boolean(String(title || author || '').trim());
  // 360 = 1.5 行距（Word 的 "w:line" 是 240 分之一行的倍数）。稿件模式加宽到
  // 420（约 1.75 倍），审稿人在纸质稿上手写批注时有行间空白可用。
  const bodyLine = hasHeader ? 420 : 360;

  const body = [];

  const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  // Two breaks back to back render as a completely blank page in Word, and an
  // empty chapter produces one too. Both are easy to create here (cover break +
  // first-chapter break, or a chapter with whitespace-only content), so every
  // break goes through a helper that collapses runs and refuses to open the
  // document with a page break.
  const pushBreak = () => {
    if (body.length === 0) return;
    if (body[body.length - 1] === PAGE_BREAK) return;
    body.push(PAGE_BREAK);
  };

  if (hasCover) {
    // 页面正文宽度（twips）换算为 EMU：1 twip = 635 EMU
    const contentWidthTwips = PAGE_WIDTH - MARGIN_LR * 2;
    const emuWidth = Math.min(contentWidthTwips * 635, 16 * 914400);
    const emuHeight = Math.round(emuWidth * 1.4142);
    body.push(coverParagraphXml(coverBase64, coverKind, emuWidth, emuHeight));
    if (pageBreak) pushBreak();
  }

  if (title) {
    body.push(paraXml(title, { style: 'Title', spacing: { line: 360 } }));
    if (author) body.push(paraXml(author, { style: 'Subtitle' }));
    // No break after the title block: the first chapter starts on the same page,
    // directly under the title and author. A dedicated title page wastes a sheet,
    // and combined with the chapter break below it produced a blank page.
  }

  const list = Array.isArray(chapters) ? chapters : [];
  list.forEach((chapter, index) => {
    const chapterTitle = String(chapter?.title ?? '').trim();
    const level = Number.isFinite(chapter?.level) ? Math.min(Math.max(Number(chapter.level), 1), 3) : 1;
    const style = level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3';
    const content = String(chapter?.content ?? '');
    const lines = content.split(/\r\n|\r|\n/);
    const hasBody = lines.some((line) => line.trim().length > 0);
    // A chapter with no text is an outline placeholder, not part of the
    // manuscript: printing its heading alone leaves an editor looking at a
    // title with nothing under it, and (with the chapter break) can produce a
    // page holding one line. Skip it entirely.
    if (!hasBody) return;

    // 章与章之间分页；首章紧跟标题，不单独起页。
    if (pageBreak && index > 0) pushBreak();

    if (chapterTitle) {
      body.push(
        paraXml(chapterTitle, {
          style,
          align: 'center',
          bold: true,
          spacing: { line: 360 },
        }),
      );
    }

    for (const line of lines) {
      body.push(paraXml(line, { indent: line.trim().length > 0, spacing: { line: bodyLine } }));
    }
  });

  if (list.length === 0 && !title) body.push(paraXml('', {}));

  // Trailing copy (contract §10): one independent block after the body, told
  // apart from the last paragraph by a single empty spacer paragraph.
  const appendText = typeof opts.appendText === 'string' ? opts.appendText : '';
  if (appendText.trim()) {
    if (list.length > 0 || title || hasCover) body.push(paraXml('', {}));
    const lines = appendText.replace(/\r\n|\r/g, '\n').split('\n');
    for (const line of lines) {
      // Keep intentional indentation: only trim for the "is this a blank line" test.
      body.push(paraXml(line, { indent: line.trim().length > 0, spacing: { line: 360 } }));
    }
  }
  const documentXml =
    `${XML_DECL}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body.join('')}${sectPrXml(hasHeader)}</w:body></w:document>`;

  const files = {
    '[Content_Types].xml': contentTypesXml(hasCover, coverKind ? imageExtFor(coverKind) : null, hasHeader),
    '_rels/.rels': rootRelsXml(),
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml(),
    'word/settings.xml': settingsXml(),
    'word/footer1.xml': footerXml(),
    'word/_rels/document.xml.rels': documentRelsXml(hasCover, hasHeader),
    'docProps/core.xml': coreXml({ title, author, created }),
    'docProps/app.xml': appXml(),
  };

  if (hasCover) {
    files['word/media/cover.png'] = Buffer.from(coverBase64, 'base64');
  }

  if (hasHeader) {
    // Two header parts since R20: the running one (page 2+) and a blank one for
    // the title page, which carries the title in the body already.
    files['word/header1.xml'] = headerXml({ title, author });
    files['word/header2.xml'] = blankHeaderXml();
  }

  return zipSync(files, { store: [], date: created });
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

/** Extract the paragraphs of a single `<w:p>` element, in document order. */
function paragraphTexts(pXml) {
  let out = '';
  const re = /<w:(\/?)(t|br|tab|cr)\b([^>]*?)(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(pXml)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    if (!tag) continue; // comment / processing instruction
    if (tag === 't') {
      if (closing) continue;
      const selfClosing = m[4] === '/';
      if (selfClosing) continue;
      const openEnd = re.lastIndex;
      const close = pXml.indexOf('</w:t>', openEnd);
      if (close < 0) {
        out += decodeXml(pXml.slice(openEnd));
        re.lastIndex = pXml.length;
      } else {
        out += decodeXml(pXml.slice(openEnd, close));
        re.lastIndex = close + '</w:t>'.length;
      }
    } else if (tag === 'br' || tag === 'cr') {
      if (!closing) {
        // `<w:br w:type="page"/>` / `column` only move the cursor; they carry no
        // text. A plain `<w:br/>` is a soft line break and becomes "\n".
        const pageLike = /\bw:type\s*=\s*"(?:page|column)"/.test(m[3] || '');
        if (!pageLike) out += '\n';
      }
    } else if (tag === 'tab') {
      if (!closing) out += '\t';
    }
  }
  return out;
}

function paragraphStyle(pXml) {
  const m = /<w:pStyle\b[^>]*\bw:val="([^"]*)"/.exec(pXml);
  return m ? decodeXml(m[1]) : 'Normal';
}

function readCoreXml(files) {
  const raw = files.get('docProps/core.xml');
  const out = { title: '', author: '' };
  if (!raw) return out;
  const xml = raw.toString('utf8');
  const title = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml);
  const creator = /<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(xml);
  if (title) out.title = decodeXml(title[1]).trim();
  if (creator) out.author = decodeXml(creator[1]).trim();
  return out;
}

/** Split a document body into raw `<w:p ...>...</w:p>` chunks. */
function splitParagraphs(xml) {
  const chunks = [];
  // `<w:p` must be followed by `>`, `/` or whitespace, otherwise `<w:pPr>` and
  // friends would be mistaken for paragraph starts.
  const re = /<w:p(?=[\s/>])(?:[^>]*)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index;
    const openEnd = m.index + m[0].length;
    if (m[0].endsWith('/>')) {
      chunks.push('');
      continue;
    }
    // Walk forward honouring nested <w:p> (rare, but tables/altChunks can nest).
    let depth = 1;
    let cursor = openEnd;
    const nestedRe = /<w:p(?=[\s/>])(?:[^>]*)>|<\/w:p>/g;
    nestedRe.lastIndex = cursor;
    while (depth > 0) {
      const next = nestedRe.exec(xml);
      if (!next) {
        cursor = xml.length;
        break;
      }
      if (next[0] === '</w:p>') {
        depth -= 1;
        cursor = next.index + next[0].length;
      } else if (next[0].endsWith('/>')) {
        // self-closing nested paragraph: no depth change
        cursor = next.index + next[0].length;
      } else {
        depth += 1;
        cursor = next.index + next[0].length;
      }
    }
    chunks.push(xml.slice(start, Math.min(cursor, xml.length)));
    re.lastIndex = Math.max(re.lastIndex, cursor);
  }
  return chunks;
}

/**
 * Parse a Word document back into paragraphs.
 *
 * @param {Buffer|Uint8Array} input
 * @returns {{title: string, author: string, paragraphs: Array<{text: string, style: string}>}}
 */
export function parseDocx(input) {
  const files = unzipSync(input);
  const raw = files.get('word/document.xml');
  if (!raw) throw new Error('不是有效的 DOCX 文件（缺少 word/document.xml）');

  const xml = raw.toString('utf8');
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const paragraphs = [];
  for (const chunk of splitParagraphs(body)) {
    const style = paragraphStyle(chunk);
    const text = paragraphTexts(chunk);
    paragraphs.push({ text, style });
  }

  const core = readCoreXml(files);
  let title = core.title;
  if (!title) {
    const firstHeading = paragraphs.find((p) => /^(Title|Heading1)$/i.test(p.style) && p.text.trim());
    if (firstHeading) title = firstHeading.text.trim();
  }
  let author = core.author;

  return { title, author, paragraphs };
}
