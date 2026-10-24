;(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // NW.format — word counting, Chinese typesetting, line diffs, chapter splitting.
  // Everything here is pure (no DOM, no IDB) so it is safe to call from anywhere.
  // ---------------------------------------------------------------------------

  const CJK_RE =
    /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/;
  const CJK_ONLY_RE =
    /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

  /** Chapter heading detector — identical to CONTRACT.md §3 so import and typeset agree. */
  const CHAPTER_RE =
    /^\s*(?:第[零一二三四五六七八九十百千万两0-9]+[章节回卷篇部集]|Chapter\s+\d+|序章|楔子|尾声|后记|番外|(?:[0-9]{1,4})[、.．]\s*\S)/;

  const CN_DIGITS = '零一二三四五六七八九';

  function isCjk(ch) {
    return !!ch && CJK_RE.test(ch);
  }

  function toCnNumber(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0 || n > 9999) return String(value);
    if (n < 10) return CN_DIGITS.charAt(n);
    if (n < 20) {
      const rest = n % 10;
      return '十' + (rest ? CN_DIGITS.charAt(rest) : '');
    }
    const units = ['千', '百', '十', ''];
    const digits = String(n).padStart(4, '0').split('').map(Number);
    let out = '';
    let zero = false;
    for (let i = 0; i < 4; i += 1) {
      const d = digits[i];
      if (d === 0) {
        zero = out.length > 0;
        continue;
      }
      if (zero) {
        out += '零';
        zero = false;
      }
      out += CN_DIGITS.charAt(d) + units[i];
    }
    return out || '零';
  }

  // ------------------------------- word count --------------------------------

  /**
   * R16 ⑥: module-level mirror of the `countPunctuation` setting.
   *
   * Every counter in the app funnels through wordCount(), and the setting can be
   * flipped from Settings at any time. Threading an option through a dozen call
   * sites would leave one of them stale (that is exactly how the status bar and
   * the submission preview disagreed before), so the flag lives here and the app
   * pushes it in whenever settings load or change.
   */
  let countPunctuation = true;

  function setCountPunctuation(on) {
    countPunctuation = on !== false;
  }

  /** Current value of the 标点 switch, for callers with their own counter. */
  function includePunctuation() {
    return countPunctuation;
  }

  /**
   * CJK characters count individually; runs of latin/other word characters count as one word.
   * Whitespace is ignored, mirroring the way Chinese editors report 字数.
   *
   * R16 ⑥: punctuation counts as one character each unless the setting is off.
   * The base algorithm is untouched — marks are *added on top* — so switching the
   * setting never changes what a "word" means, it only drops the marks.
   */
  function wordCount(text, options) {
    if (text == null || text === '') return 0;
    const value = String(text);
    const withPunctuation =
      options && options.includePunctuation !== undefined
        ? options.includePunctuation !== false
        : countPunctuation;
    let count = 0;
    let inWord = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charAt(i);
      const code = value.charCodeAt(i);
      if (CJK_ONLY_RE.test(ch)) {
        count += 1;
        inWord = false;
      } else if (/\s/.test(ch)) {
        inWord = false;
      } else if (/[A-Za-z0-9_'\u00c0-\u024f]/.test(ch)) {
        if (!inWord) count += 1;
        inWord = true;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        // surrogate pair (emoji / rare CJK ext) — count once
        count += 1;
        inWord = false;
        i += 1;
      } else {
        // Punctuation and symbols land here. CJK punctuation (。，「」…) is in
        // the CJK blocks but not in CJK_ONLY_RE, so it is counted here too.
        if (withPunctuation) count += 1;
        inWord = false;
      }
    }
    return count;
  }

  // -------------------------------- typeset ---------------------------------

  function recordEdit(edits, kind, before, after, index) {
    if (before === after) return;
    edits.push({ kind: kind, before: before, after: after, index: index });
  }

  /** Converts half-width punctuation to full-width when it sits in a Chinese context. */
  function convertPunctuation(line, base, edits) {
    const fullMap = { ',': '，', '!': '！', '?': '？', ':': '：', ';': '；' };
    let out = '';
    for (let i = 0; i < line.length; i += 1) {
      const ch = line.charAt(i);
      const prev = out.charAt(out.length - 1) || '';
      const next = line.charAt(i + 1) || '';
      const cjkContext = isCjk(prev) || isCjk(next);
      if (fullMap[ch] && cjkContext) {
        recordEdit(edits, 'punctuation', ch, fullMap[ch], base + i);
        out += fullMap[ch];
        continue;
      }
      if (ch === '.') {
        const digitBefore = /[0-9]/.test(prev);
        const digitAfter = /[0-9]/.test(next);
        if (digitBefore && digitAfter) {
          out += ch;
          continue;
        }
        if (isCjk(prev) || isCjk(next)) {
          recordEdit(edits, 'punctuation', '.', '。', base + i);
          out += '。';
          continue;
        }
      }
      out += ch;
    }
    return out;
  }

  /** `...`/`。。。` → `……` and `--`/`—` runs → `——`. */
  function normalizeDashesAndEllipsis(line, base, edits) {
    let out = line;
    out = out.replace(/\.{3,}|。{3,}|．{3,}/g, (...args) => {
      const match = args[0];
      const offset = args[args.length - 2];
      recordEdit(edits, 'ellipsis', match, '……', base + offset);
      return '……';
    });
    out = out.replace(/-{2,}|—{2,}|–{2,}/g, (...args) => {
      const match = args[0];
      const offset = args[args.length - 2];
      if (match === '——') return match;
      recordEdit(edits, 'dash', match, '——', base + offset);
      return '——';
    });
    return out;
  }

  /** Straight quotes → curly quotes, only for Chinese-context runs. */
  function normalizeQuotes(line, base, edits) {
    let out = '';
    let openDouble = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line.charAt(i);
      if (ch === '"') {
        const prev = out.charAt(out.length - 1) || '';
        const next = line.charAt(i + 1) || '';
        const prevIsWord = !!(prev && /[A-Za-z0-9]/.test(prev));
        const nextIsWord = !!(next && /[A-Za-z0-9]/.test(next));
        if (prevIsWord && nextIsWord) {
          out += ch; // inches / quoted identifier inside latin text
          continue;
        }
        const nextQuote = openDouble ? '”' : '“';
        openDouble = !openDouble;
        recordEdit(edits, 'quote', ch, nextQuote, base + i);
        out += nextQuote;
        continue;
      }
      if (ch === "'" && (isCjk(out.charAt(out.length - 1)) || isCjk(line.charAt(i + 1)))) {
        const prev = out.charAt(out.length - 1) || '';
        const quote = /[“（【「]/.test(prev) || !prev ? '‘' : '’';
        recordEdit(edits, 'quote', ch, quote, base + i);
        out += quote;
        continue;
      }
      out += ch;
    }
    return out;
  }

  const HEADING_BODY_RE =
    /^\s*(?:第\s*([0-9零一二三四五六七八九十百千万两]+)\s*([章节回卷篇部集])\s*(.*)|(Chapter\s+([0-9]+))\s*(.*)|(序章|楔子|尾声|后记|番外)\s*(.*)|([0-9]{1,4})\s*[、.．]\s*(.*))$/;

  /** Rewrites a heading line as `第X章 标题` (Chinese numeral, one ASCII space). */
  function normalizeHeading(line, base, edits) {
    const m = HEADING_BODY_RE.exec(line);
    if (!m) return line;
    // strip a separator punctuation that followed the chapter marker (`第1章、标题`)
    const clean = (value) => String(value || '').trim().replace(/^[、，,．.:：;；\-—\s]+/, '').trim();
    let next = '';
    if (m[1] != null) {
      const num = /^[0-9]+$/.test(m[1]) ? toCnNumber(Number(m[1])) : m[1];
      const body = clean(m[3]);
      next = '第' + num + m[2] + (body ? ' ' + body : '');
    } else if (m[5] != null) {
      const body = clean(m[6]);
      next = 'Chapter ' + m[5] + (body ? ' ' + body : '');
    } else if (m[7] != null) {
      const body = clean(m[8]);
      next = m[7] + (body ? ' ' + body : '');
    } else if (m[9] != null) {
      const body = clean(m[10]);
      next = '第' + toCnNumber(Number(m[9])) + '章' + (body ? ' ' + body : '');
    } else {
      return line;
    }
    if (next !== line) recordEdit(edits, 'heading', line.trim(), next, base);
    return next;
  }

  function isHeadingLine(line) {
    const text = String(line || '').trim();
    if (!text || text.length > 60) return false;
    return CHAPTER_RE.test(text);
  }

  /**
   * Splits `…。“对话”` / `“甲说。”“乙说。”` style runs so every dialogue block starts
   * its own paragraph. A reporting clause glued to the quote without a terminator
   * (`他说“你好”。`) is intentionally left intact — that reads as one paragraph.
   */
  function splitDialogue(line, opts) {
    if (opts.dialogue === false) return [line];
    const parts = [];
    let rest = line;
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const m = /^(.*?)(\s*)(“[^“”]*”)(.*)$/.exec(rest);
      if (!m) break;
      const head = m[1];
      const quote = m[3];
      if (!head.trim()) break; // already starts with the dialogue
      const last = head.replace(/\s+$/, '').slice(-1);
      // only split when the narrative clause is finished, or right after a previous quote
      if (!/[。！？!?…—]/.test(last)) break;
      parts.push(head.trim());
      rest = quote + m[4];
    }
    if (parts.length === 0) return [line];
    if (rest.trim()) parts.push(rest.trim());
    return parts;
  }

  function collapseBlankLines(text) {
    return text.replace(/\n[ \t\u3000]*\n(?:[ \t\u3000]*\n)+/g, '\n\n');
  }

  /**
   * Chinese typesetting pass.
   * @returns {{text: string, edits: Array<{kind, before, after, index}>}}
   * `index` of every edit is a character offset into the ORIGINAL input text, so the
   * UI can map a change back to what the author actually wrote.
   */
  function typeset(text, opts) {
    const options = opts || {};
    const src = text == null ? '' : String(text);
    const edits = [];
    if (!src) return { text: src, edits: edits };

    const lines = src.split('\n');
    const rendered = [];
    let offset = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const original = lines[i];
      const base = offset;
      offset += original.length + 1;

      let line = original;

      // 1. strip trailing spaces
      const noTrail = line.replace(/[ \t\u00a0]+$/, '');
      if (noTrail !== line) {
        recordEdit(edits, 'trailing', line.slice(noTrail.length), '', base + noTrail.length);
        line = noTrail;
      }

      // 2. normalise heading (before punctuation so `第1章,xxx` keeps its comma)
      const heading = isHeadingLine(line);
      if (heading && options.heading !== false) line = normalizeHeading(line, base, edits);

      // 3. dashes / ellipsis / punctuation / quotes
      if (options.punctuation !== false) {
        line = normalizeDashesAndEllipsis(line, base, edits);
        line = convertPunctuation(line, base, edits);
        line = normalizeQuotes(line, base, edits);
      }

      // 4. blank line handling
      if (line.trim() === '') {
        rendered.push('');
        continue;
      }

      // 5. dialogue split (only for narrative lines, never for headings)
      const pieces = heading ? [line] : splitDialogue(line, options);
      if (pieces.length > 1) {
        recordEdit(edits, 'dialogue', line, pieces.join('\n'), base);
      }

      // 6. two-character first-line indent
      for (let p = 0; p < pieces.length; p += 1) {
        let piece = pieces[p];
        if (options.indent === false || heading) {
          rendered.push(piece);
          continue;
        }
        if (piece.charAt(0) === '\u3000' && piece.charAt(1) === '\u3000') {
          rendered.push(piece);
          continue;
        }
        const trimmed = piece.replace(/^[ \t]+/, '');
        if (trimmed !== piece) recordEdit(edits, 'trailing', piece.slice(0, piece.length - trimmed.length), '', base);
        if (trimmed) {
          recordEdit(edits, 'indent', '', '\u3000\u3000', base);
          rendered.push('\u3000\u3000' + trimmed);
        } else {
          rendered.push('');
        }
      }
    }

    let out = rendered.join('\n');
    const beforeBlank = out;
    out = collapseBlankLines(out);
    if (out !== beforeBlank) {
      recordEdit(edits, 'blank', '\\n{3,}', '\\n\\n', 0);
    }
    out = out.replace(/^\n+/, '').replace(/\n+$/, '\n');
    if (!/\n$/.test(out) && out) out += '\n';

    edits.sort((a, b) => a.index - b.index);
    return { text: out, edits: edits };
  }

  // ------------------------------ diff preview ------------------------------

  /** Line-level LCS diff. Adjacent rows of the same type are merged. */
  function diffPreview(a, b) {
    // R26: a lone trailing newline is not a visible edit. typeset() always ends
    // its output with exactly one newline, so a manuscript typed without a final
    // line break produced a phantom add row (rendered as a bare plus sign) and
    // made the apply button look enabled when nothing needed changing. Strip one
    // trailing newline from each side before splitting; internal blank-line
    // changes are unaffected.
    const trimEnd = (value) => {
      const text = String(value == null ? '' : value);
      return text.slice(-1) === '\n' ? text.slice(0, -1) : text;
    };
    const left = trimEnd(a).split('\n');
    const right = trimEnd(b).split('\n');

    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
    let endL = left.length - 1;
    let endR = right.length - 1;
    while (endL >= start && endR >= start && left[endL] === right[endR]) {
      endL -= 1;
      endR -= 1;
    }

    const aMid = left.slice(start, endL + 1);
    const bMid = right.slice(start, endR + 1);
    const ops = [];

    if (aMid.length * bMid.length > 4000000) {
      for (let i = 0; i < aMid.length; i += 1) ops.push({ type: 'del', text: aMid[i] });
      for (let i = 0; i < bMid.length; i += 1) ops.push({ type: 'add', text: bMid[i] });
    } else {
      const n = aMid.length;
      const m = bMid.length;
      // lcs[i][j] = LCS length of aMid[i..] vs bMid[j..]
      const width = m + 1;
      const lcs = new Uint32Array((n + 1) * width);
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          const at = i * width + j;
          if (aMid[i] === bMid[j]) lcs[at] = lcs[(i + 1) * width + (j + 1)] + 1;
          else {
            const down = lcs[(i + 1) * width + j];
            const right = lcs[i * width + (j + 1)];
            lcs[at] = down >= right ? down : right;
          }
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (aMid[i] === bMid[j]) {
          ops.push({ type: 'same', text: aMid[i] });
          i += 1;
          j += 1;
        } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
          ops.push({ type: 'del', text: aMid[i] });
          i += 1;
        } else {
          ops.push({ type: 'add', text: bMid[j] });
          j += 1;
        }
      }
      while (i < n) {
        ops.push({ type: 'del', text: aMid[i] });
        i += 1;
      }
      while (j < m) {
        ops.push({ type: 'add', text: bMid[j] });
        j += 1;
      }
    }

    const head = [];
    for (let i = 0; i < start; i += 1) head.push({ type: 'same', text: left[i] });
    const tail = [];
    for (let i = endL + 1; i < left.length; i += 1) tail.push({ type: 'same', text: left[i] });

    const merged = [];
    const push = (row) => {
      const prev = merged[merged.length - 1];
      if (prev && prev.type === row.type) prev.text += '\n' + row.text;
      else merged.push({ type: row.type, text: row.text });
    };
    head.forEach(push);
    ops.forEach(push);
    tail.forEach(push);
    return merged;
  }

  // ------------------------------- chapter split -----------------------------

  /**
   * Splits imported plain text into chapters using CONTRACT §3's heading regex.
   * Text before the first heading becomes chapter 1.
   */
  function autoChapterSplit(text, fallbackTitle) {
    const src = text == null ? '' : String(text).replace(/\r\n?/g, '\n');
    const fallback = String(fallbackTitle || '正文').trim() || '正文';
    if (!src.trim()) return [{ title: fallback, content: '' }];

    const lines = src.split('\n');
    const marks = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (CHAPTER_RE.test(lines[i])) marks.push(i);
    }

    const chapters = [];
    if (marks.length === 0) {
      return [{ title: fallback, content: src.trim() }];
    }

    if (marks[0] > 0) {
      const pre = lines.slice(0, marks[0]).join('\n').trim();
      if (pre) {
        const preLines = pre.split('\n');
        const firstLine = preLines[0].trim();
        const restText = preLines.slice(1).join('\n').trim();
        // Treat the first line as the chapter title only when it reads like one
        // (short, no sentence punctuation) and there is body text left behind;
        // otherwise keep everything as content so no prose is ever dropped.
        const looksLikeTitle =
          firstLine.length > 0 &&
          firstLine.length <= 30 &&
          restText.length > 0 &&
          !/[。！？…，、；：]$/.test(firstLine);
        if (looksLikeTitle) chapters.push({ title: firstLine, content: restText });
        else chapters.push({ title: fallback, content: pre });
      }
    }

    for (let k = 0; k < marks.length; k += 1) {
      const from = marks[k];
      const to = k + 1 < marks.length ? marks[k + 1] : lines.length;
      const block = lines.slice(from, to);
      let title = String(block[0] || '').trim();
      if (!title) title = '第' + (chapters.length + 1) + '章';
      // A heading line that keeps running into prose: keep the whole line as title,
      // the remainder of the paragraph becomes content on the next line.
      const body = block.slice(1).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
      chapters.push({ title: title, content: body });
    }

    return chapters.length ? chapters : [{ title: fallback, content: src.trim() }];
  }

  // ------------------------------ markdown → plain ---------------------------

  function markdownToPlain(text) {
    if (text == null || text === '') return '';
    let out = String(text).replace(/\r\n?/g, '\n');
    out = out.replace(/^[ \t]*```[^\n]*$/gm, '');
    out = out.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, '');
    out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
    out = out.replace(/^[ \t]*>[ \t]?/gm, '');
    out = out.replace(/^[ \t]*[-*+][ \t]+/gm, '');
    out = out.replace(/^[ \t]*\d+[.)][ \t]+/gm, '');
    out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
    out = out.replace(/(\*|_)(.*?)\1/g, '$2');
    out = out.replace(/~~(.*?)~~/g, '$1');
    out = out.replace(/`([^`]*)`/g, '$1');
    out = out.replace(/<[^>\n]{1,120}>/g, '');
    out = out.replace(/[ \t]+$/gm, '');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.replace(/^\n+/, '').replace(/\s+$/, '\n');
  }

  // -------------------------------- apply edits ------------------------------

  /**
   * Applies accepted proofreading edits right-to-left so earlier offsets stay valid.
   * @param edits [{id?, start, end, replacement}]
   * @param acceptedIds null/undefined = accept all, else Set | Array | predicate
   */
  function applyEdits(text, edits, acceptedIds) {
    const src = text == null ? '' : String(text);
    const list = Array.isArray(edits) ? edits.slice() : [];
    if (list.length === 0) return src;

    let accept;
    if (acceptedIds == null) {
      accept = () => true;
    } else if (typeof acceptedIds === 'function') {
      accept = acceptedIds;
    } else {
      const set = acceptedIds instanceof Set ? acceptedIds : new Set(acceptedIds || []);
      accept = (edit, idx) => set.has(edit && edit.id != null ? edit.id : idx);
    }

    const usable = [];
    for (let i = 0; i < list.length; i += 1) {
      const edit = list[i] || {};
      if (!accept(edit, i)) continue;
      const start = Math.max(0, Math.min(src.length, Number(edit.start) || 0));
      const end = Math.max(start, Math.min(src.length, Number(edit.end) || 0));
      const replacement = edit.replacement == null ? '' : String(edit.replacement);
      usable.push({ start: start, end: end, replacement: replacement });
    }
    usable.sort((a, b) => b.start - a.start || b.end - a.end);

    let out = src;
    // Right-to-left: every edit must end at or before the previously applied edit's
    // start, otherwise the two overlap and the later (left) one is skipped.
    let limit = src.length;
    for (let i = 0; i < usable.length; i += 1) {
      const edit = usable[i];
      if (edit.end > limit) continue;
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
      limit = edit.start;
    }
    return out;
  }

  NW.format = {
    wordCount: wordCount,
    setCountPunctuation: setCountPunctuation,
    includePunctuation: includePunctuation,
    typeset: typeset,
    diffPreview: diffPreview,
    autoChapterSplit: autoChapterSplit,
    markdownToPlain: markdownToPlain,
    applyEdits: applyEdits,
    isHeadingLine: isHeadingLine,
    toCnNumber: toCnNumber,
    CHAPTER_RE: CHAPTER_RE,
  };
})();
