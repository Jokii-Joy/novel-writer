/**
 * Import parsing for the Novel Studio host: `.txt`, `.md`, `.markdown`, `.docx`,
 * `.epub` → `{title, author, chapters:[{title, content}]}`.
 *
 * Chapter boundaries follow docs/CONTRACT.md §3:
 *   ^\s*(?:第[零一二三四五六七八九十百千万两0-9]+[章节回卷篇部集]|Chapter\s+\d+|序章|楔子|尾声|后记|番外|(?:[0-9]{1,4})[、.．]\s*\S)
 * Text before the first match becomes chapter 1, titled from its first short
 * line (or the novel title).
 *
 * Text decoding: strict UTF-8 first; when that fails or the result is full of
 * U+FFFD replacement characters, retry as GB18030 (node's built-in ICU).
 */

import { parseDocx } from './docx.js';
import { parseEpub } from './epub.js';

/** CONTRACT §3 chapter title detector. */
export const CHAPTER_TITLE_RE =
  /^\s*(?:第[零一二三四五六七八九十百千万两0-9]+[章节回卷篇部集]|Chapter\s+\d+|序章|楔子|尾声|后记|番外|(?:[0-9]{1,4})[、.．]\s*\S)/;

const MAX_CHAPTER_TITLE_LEN = 40;

/* ------------------------------------------------------------------ */
/* decoding                                                            */
/* ------------------------------------------------------------------ */

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.alloc(0);
}

function replacementRatio(text) {
  if (!text.length) return 0;
  let bad = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) bad += 1;
  return bad / text.length;
}

/**
 * Decode a text buffer, preferring UTF-8 and falling back to GB18030.
 * @param {Buffer} buf
 * @returns {{text: string, encoding: 'utf-8'|'gb18030'}}
 */
export function decodeText(buf) {
  const bytes = toBuffer(buf);
  let text = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = null;
  }
  if (text !== null && replacementRatio(text) < 0.002) {
    return { text: stripBom(text), encoding: 'utf-8' };
  }
  try {
    const gb = new TextDecoder('gb18030').decode(bytes);
    if (replacementRatio(gb) <= (text === null ? 1 : replacementRatio(text))) {
      return { text: stripBom(gb), encoding: 'gb18030' };
    }
  } catch {
    /* fall through */
  }
  return { text: stripBom(text ?? new TextDecoder('utf-8').decode(bytes)), encoding: 'utf-8' };
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* ------------------------------------------------------------------ */
/* markdown → plain text                                               */
/* ------------------------------------------------------------------ */

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // inline / multi-backtick code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/<[^>]+>/g, '') // raw html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Convert markdown to plain text while keeping heading levels.
 *
 * @param {string} markdown
 * @returns {{text: string, headings: Array<{line: number, level: number, title: string}>}}
 */
export function markdownToPlain(markdown) {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const out = [];
  const headings = [];
  let inFence = false;
  let fenceMarker = '';

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');

    // Fenced code blocks keep their content verbatim.
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
        continue;
      }
      if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
        continue;
      }
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = stripInlineMarkdown(heading[2]).trim();
      headings.push({ line: out.length, level, title });
      out.push(title);
      continue;
    }

    // Setext headings (=== / --- under a line) become level 1 / 2.
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(line);
    if (setext && out.length > 0 && out[out.length - 1].trim()) {
      const level = setext[1][0] === '=' ? 1 : 2;
      const title = out[out.length - 1].trim();
      headings.push({ line: out.length - 1, level, title });
      continue; // drop the underline itself
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(''); // horizontal rule
      continue;
    }

    let text = line;
    // Blockquote markers
    text = text.replace(/^\s{0,3}>\s?/, '');
    // Task list / bullet / ordered list markers
    text = text.replace(/^\s*([-*+])\s+\[[ xX]\]\s+/, '· ');
    text = text.replace(/^\s*([-*+])\s+/, '· ');
    text = text.replace(/^(\s*)\d+[.)]\s+/, '$1');

    out.push(stripInlineMarkdown(text).replace(/[ \t]+$/, ''));
  }

  return { text: out.join('\n'), headings };
}

/* ------------------------------------------------------------------ */
/* chapter splitting                                                   */
/* ------------------------------------------------------------------ */

function lines(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  return normalized.split('\n');
}

function titleFromFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const withoutExt = base.replace(/\.[^.]+$/, '');
  return withoutExt.trim() || '未命名';
}

function detectAuthor(linesToScan) {
  for (const line of linesToScan) {
    const m = /^\s*(?:作者|著者|Author|By)\s*[:：]\s*(.+?)\s*$/i.exec(line);
    if (m) return m[1].trim();
  }
  return '';
}

/** Title for the leading (title-less) section. */
function leadingTitle(bodyLines, fallback) {
  for (const line of bodyLines) {
    const text = line.trim();
    if (!text) continue;
    if (text.length <= MAX_CHAPTER_TITLE_LEN) return text;
    break;
  }
  return fallback;
}

/**
 * Split plain text into chapters using the CONTRACT §3 regex.
 *
 * @param {string} text
 * @param {object} [meta]
 * @param {string} [meta.title] novel title used for the leading section
 * @param {boolean} [meta.markdown] also split on markdown level-1/2 headings
 * @param {Array<{line:number, level:number, title:string}>} [meta.headings]
 * @returns {Array<{title: string, content: string, level?: number}>}
 */
export function splitChapters(text, meta = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) return [];
  const all = lines(text);
  const fallbackTitle = meta.title || '未命名';
  const markdownHeadings = new Map();
  if (meta.markdown && Array.isArray(meta.headings)) {
    for (const h of meta.headings) {
      if (h.level <= 2 && h.title) markdownHeadings.set(h.line, h);
    }
  }

  const chapters = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    const content = current.body.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    const title = current.title || leadingTitle(current.body, fallbackTitle);
    const body = current.title ? content : current.body.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    // Drop the very first line when it was reused as the chapter title.
    let finalContent = body;
    if (!current.title) {
      const bodyLines = body.split('\n');
      if (bodyLines.length > 1 && bodyLines[0].trim() === title) finalContent = bodyLines.slice(1).join('\n').replace(/^\n+/, '');
    }
    chapters.push({
      title: title || fallbackTitle,
      content: finalContent,
      ...(current.level ? { level: current.level } : {}),
    });
    current = null;
  };

  for (let index = 0; index < all.length; index += 1) {
    const line = all[index];
    const mdHeading = markdownHeadings.get(index);
    const isBoundary = CHAPTER_TITLE_RE.test(line) || Boolean(mdHeading);
    if (isBoundary) {
      pushCurrent();
      const headingText = (mdHeading ? mdHeading.title : line).trim();
      current = {
        title: headingText,
        body: [],
        level: mdHeading ? mdHeading.level : undefined,
      };
      continue;
    }
    if (!current) current = { title: '', body: [] };
    current.body.push(line);
  }
  pushCurrent();

  const kept = chapters.filter((chapter) => chapter.title || chapter.content.trim());
  if (kept.length === 0) {
    const raw = String(text ?? '').trim();
    return raw ? [{ title: fallbackTitle, content: raw }] : [];
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* formats                                                             */
/* ------------------------------------------------------------------ */

function parseText({ name, bytes }) {
  const buf = toBuffer(bytes);
  const { text } = decodeText(buf);
  const all = lines(text);
  const novelTitle = titleFromFilename(name);
  const author = detectAuthor(all.slice(0, 20));

  const chapters = splitChapters(text, { title: `${novelTitle} · 正文` });
  // Leading section without a heading gets the novel title rather than the
  // fabricated "· 正文" fallback when it is the only section.
  if (chapters.length === 1 && chapters[0].title === `${novelTitle} · 正文`) {
    chapters[0].title = novelTitle;
  }
  return { title: novelTitle, author, chapters };
}

function parseMarkdown({ name, bytes }) {
  const buf = toBuffer(bytes);
  const { text: decoded } = decodeText(buf);
  const novelTitle = titleFromFilename(name);
  const { text, headings } = markdownToPlain(decoded);
  const author = detectAuthor(lines(text).slice(0, 20));

  // A leading level-1 heading usually names the book, not chapter 1.
  const docTitleCandidate = headings.find((h) => h.level === 1 && h.line === 0 && h.title);
  const chapters = splitChapters(text, { title: `${novelTitle} · 正文`, markdown: true, headings });
  if (chapters.length === 1 && chapters[0].title === `${novelTitle} · 正文`) {
    chapters[0].title = novelTitle;
  }
  const title = docTitleCandidate && chapters.length > 1 ? docTitleCandidate.title : novelTitle;
  return { title, author, chapters };
}

function chaptersFromDocx({ title, author, paragraphs }) {
  const chapters = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    chapters.push({
      title: current.title,
      content: current.body.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''),
    });
    current = null;
  };

  // Title / Subtitle carry the book name and author, not chapter boundaries.
  const isBookTitle = (style) => /^(Title|Subtitle)$/i.test(style || '');
  const isHeading = (style) => /^Heading[1-6]$/i.test(style || '');

  for (const paragraph of paragraphs) {
    const text = String(paragraph.text ?? '').replace(/\r\n?/g, '\n');
    if (isBookTitle(paragraph.style)) continue;
    if (isHeading(paragraph.style)) {
      const headingTitle = text.trim();
      if (!headingTitle) continue;
      flush();
      current = { title: headingTitle, body: [] };
      continue;
    }
    if (!current) current = { title: '', body: [] };
    current.body.push(text);
  }
  flush();

  if (chapters.every((chapter) => !chapter.title)) {
    // No styled headings: fall back to the text chapter regex.
    const plain = paragraphs.map((p) => p.text).join('\n');
    return splitChapters(plain, { title: title || '未命名' });
  }
  return chapters.filter((chapter) => chapter.title || chapter.content.trim());
}

function parseDocxImport({ name, bytes }) {
  const buf = toBuffer(bytes);
  const parsed = parseDocx(buf);
  const novelTitle = parsed.title || titleFromFilename(name);
  const chapters = chaptersFromDocx({ ...parsed, title: novelTitle });
  return { title: novelTitle, author: parsed.author || '', chapters };
}

function parseEpubImport({ name, bytes }) {
  const buf = toBuffer(bytes);
  const parsed = parseEpub(buf);
  let chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  if (chapters.length === 0) {
    chapters = [{ title: parsed.title || titleFromFilename(name), content: '' }];
  }
  return {
    title: parsed.title || titleFromFilename(name),
    author: parsed.author || '',
    chapters: chapters.map((chapter) => ({ title: chapter.title || '未命名', content: chapter.content || '' })),
  };
}

function extensionOf(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const m = /\.([^.]+)$/.exec(base);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Parse an imported novel file.
 *
 * @param {{name?: string, bytes?: Buffer|Uint8Array|ArrayBuffer|string}} input
 * @returns {Promise<{title: string, author: string, chapters: Array<{title: string, content: string}>}>}
 */
export async function parseImport({ name, bytes } = {}) {
  const extension = extensionOf(name);
  switch (extension) {
    case 'txt':
      return parseText({ name, bytes });
    case 'md':
    case 'markdown':
      return parseMarkdown({ name, bytes });
    case 'docx':
      return parseDocxImport({ name, bytes });
    case 'epub':
      return parseEpubImport({ name, bytes });
    default:
      // Unknown extension: treat the bytes as text when they look textual.
      return parseText({ name, bytes });
  }
}
