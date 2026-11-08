;(() => {
  'use strict';

  /**
   * R85: import advice written by another AI.
   *
   * The column has one card shape, and it should not grow a second one just
   * because the text came from a different model. So a paste is parsed into the
   * same fields the host's `revise` call returns —
   * `{quote, issue, why, advice, example, kind, severity}` — plus `start`/`end`
   * located against the chapter that is open right now. After that the cards,
   * the highlight, 接受/拒绝 and 替换/复制 all behave exactly as before.
   *
   * Two input shapes are accepted because both are what a model actually emits:
   *   1. the JSON array our own prompt asks for (fenced or bare);
   *   2. labelled lines — 原文 / 问题 / 理由 / 建议 / 改后 / 类型 / 严重度 —
   *      which is what a writer gets when they paste the prompt below into
   *      another chat and copy the answer back.
   *
   * Parsing never throws: a paste that cannot be understood returns an error
   * string the panel can show next to the box, and nothing is imported.
   */

  // R89: the bundle is one factory scope: 00-boot declares the shared `NW`, and
  // every other part writes into that same object. Declaring `const NW = …`
  // here shadowed it, so `NW.advicePaste` landed on a fresh `window.NW` that
  // 92-advice never reads — the panel then reported “复制组件没有加载”. Use the
  // factory namespace when it exists; the standalone test harness runs this
  // file with no outer `NW`, so it still falls back to `window.NW`.
  const NS = typeof NW !== 'undefined' && NW ? NW : (window.NW = window.NW || {});

  /** The ten kinds the cards know, plus the labels a writer may paste. */
  const KIND_ALIASES = new Map();
  [
    ['rhythm', '节奏', 'pacing'],
    ['diction', '用词', '语言', '表达', 'wording'],
    ['pov', '视角', 'pointofview'],
    ['detail', '画面', '细节', '描写'],
    ['dialogue', '对话', '台词'],
    ['structure', '结构', '结构节奏'],
    ['character', '人物', '角色', '人设'],
    ['logic', '逻辑', '设定'],
    ['emotion', '情绪', '情感'],
    ['redundancy', '冗余', '重复', '啰嗦'],
  ].forEach(([kind, ...labels]) => {
    KIND_ALIASES.set(kind, kind);
    labels.forEach((label) => KIND_ALIASES.set(String(label).toLowerCase(), kind));
  });

  const SEVERITY_ALIASES = new Map();
  [
    ['high', '高', '严重', '重要', 'high'],
    ['medium', '中', '一般', '普通', 'medium'],
    ['low', '低', '轻', '次要', 'low'],
  ].forEach(([level, ...labels]) => {
    SEVERITY_ALIASES.set(level, level);
    labels.forEach((label) => SEVERITY_ALIASES.set(String(label).toLowerCase(), level));
  });

  const FIELD_ALIASES = new Map();
  const FIELDS = {
    quote: ['原文', '引文', '原句', 'quote'],
    issue: ['问题', '毛病', 'issue'],
    why: ['理由', '原因', '为什么', 'why'],
    advice: ['建议', '改法', '怎么改', 'advice'],
    example: ['改后', '示例', '改写', '改后的文字', 'example', 'revised'],
    kind: ['类型', '维度', 'kind'],
    severity: ['严重度', '严重程度', '优先级', 'severity'],
  };
  Object.keys(FIELDS).forEach((field) => {
    FIELDS[field].forEach((label) => FIELD_ALIASES.set(String(label).toLowerCase(), field));
  });

  const escapeRe = (label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const LABELS = Array.from(FIELD_ALIASES.keys())
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  const FIELD_RE = new RegExp('(?:\\*\\*)?(' + LABELS + ')(?:\\*\\*)?\\s*[:：]\\s*', 'gi');
  const ENTRY_RE = new RegExp(
    '(?:^|\\n)[ \\t]*(?:\\d{1,2}[.、)）]\\s*)?(?:\\*\\*)?(?:' +
      FIELDS.quote.map(escapeRe).join('|') +
      ')(?:\\*\\*)?\\s*[:：]\\s*',
    'gi',
  );

  /** Text as a trimmed string; `null`/`undefined` become ''. */
  function textOf(value) {
    return String(value == null ? '' : value).trim();
  }

  function canonicalKind(value) {
    const key = textOf(value).toLowerCase();
    return KIND_ALIASES.get(key) || '';
  }

  function canonicalSeverity(value) {
    const key = textOf(value).toLowerCase();
    return SEVERITY_ALIASES.get(key) || 'medium';
  }

  /** The format block shown above the paste box — also copied as the prompt. */
  const TEMPLATE = [
    '请按下面的格式给修改建议，每条之间空一行：',
    '',
    '原文：从正文里逐字复制的一句（20~60 字）',
    '问题：一句话说清问题（不超过 40 字）',
    '理由：为什么是问题（不超过 60 字）',
    '建议：具体怎么改（不超过 80 字）',
    '改后：改后的文字（可选）',
    '类型：节奏 / 用词 / 视角 / 画面 / 对话 / 结构 / 人物 / 逻辑 / 情绪 / 冗余（可选）',
    '严重度：高 / 中 / 低（可选）',
    '',
    '要求：原文必须与小说正文一字不差；没有值得改的就不要编。',
    '',
    '也可以直接给 JSON 数组：[{"quote":"原文","issue":"问题","advice":"建议"}]',
  ].join('\n');

  /**
   * Split the labelled form into one object per 原文 line.
   *
   * A field value runs until the next label, so a value may wrap over several
   * lines and `原文：… 问题：…` on one line is still understood. The first
   * occurrence of a field wins; a repeated 建议 label is almost always the
   * model restating itself, and the first one is the one it meant.
   */
  function parseLabelled(raw) {
    const entries = [];
    const starts = [];
    let match;
    ENTRY_RE.lastIndex = 0;
    while ((match = ENTRY_RE.exec(raw))) starts.push(match.index);
    if (!starts.length) return null;

    for (let i = 0; i < starts.length; i += 1) {
      const chunk = raw.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : raw.length);
      const fields = {};
      const marks = [];
      FIELD_RE.lastIndex = 0;
      let hit;
      while ((hit = FIELD_RE.exec(chunk))) {
        const field = FIELD_ALIASES.get(hit[1].toLowerCase());
        if (!field) continue;
        marks.push({ field, end: hit.index + hit[0].length, index: hit.index });
      }
      for (let m = 0; m < marks.length; m += 1) {
        const mark = marks[m];
        const end = m + 1 < marks.length ? marks[m + 1].index : chunk.length;
        const value = chunk.slice(mark.end, end).replace(/\n{3,}/g, '\n\n').trim();
        if (value && !fields[mark.field]) fields[mark.field] = value;
      }
      if (fields.quote) entries.push(fields);
    }
    return entries.length ? entries : null;
  }

  /**
   * The JSON form. Fences are stripped, then the first array (or an object
   * with `suggestions`) is parsed. A chapter's quotes can contain `]`, so the
   * slice is taken greedily to the last bracket; a malformed paste falls back
   * to the labelled parser instead of failing the import.
   */
  function parseJson(raw) {
    let text = raw.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (!text) return null;
    const attempt = (value) => {
      try {
        return JSON.parse(value);
      } catch (err) {
        return null;
      }
    };
    let data = null;
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      data = attempt(text.slice(arrayStart, arrayEnd + 1));
    }
    if (!data) {
      const objectStart = text.indexOf('{');
      const objectEnd = text.lastIndexOf('}');
      if (objectStart < 0 || objectEnd <= objectStart) return null;
      const object = attempt(text.slice(objectStart, objectEnd + 1));
      if (!object) return null;
      data = Array.isArray(object) ? object : object.suggestions;
    }
    if (Array.isArray(data)) return data.filter((entry) => entry && typeof entry === 'object');
    if (data && typeof data === 'object') return [data];
    return null;
  }

  function locate(quote, source) {
    if (!source || !quote) return { start: -1, end: -1 };
    let at = source.indexOf(quote);
    if (at >= 0) return { start: at, end: at + quote.length };
    // A model sometimes hard-wraps a long quote. The manuscript has no newline
    // there, so retry with line breaks folded into spaces; if that also misses,
    // the card stays importable with start:-1 and says it cannot locate.
    const folded = quote.replace(/\s*\n+\s*/g, ' ');
    if (folded !== quote) {
      at = source.indexOf(folded);
      if (at >= 0) return { start: at, end: at + folded.length };
    }
    return { start: -1, end: -1 };
  }

  function normalise(entry, source) {
    if (!entry || typeof entry !== 'object') return null;
    const quote = textOf(entry.quote).replace(/\s*\n+\s*/g, ' ');
    if (!quote) return null;
    const issue = textOf(entry.issue);
    const why = textOf(entry.why);
    const advice = textOf(entry.advice);
    const example = textOf(entry.example || entry.revised);
    if (!issue && !advice && !example) return null;
    const span = locate(quote, source);
    return {
      quote,
      issue,
      why,
      advice,
      example,
      kind: canonicalKind(entry.kind),
      severity: canonicalSeverity(entry.severity),
      start: span.start,
      end: span.end,
    };
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.quote + '|' + item.issue;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Parse a paste against the chapter's current text.
   *
   * Resolves to `{ok, items, unlocated, error}`. `items` carry no `id` — the
   * panel assigns ids that cannot collide with the model's `r1…r8`.
   */
  function parse(raw, source) {
    const text = textOf(raw);
    if (!text) return { ok: false, items: [], unlocated: 0, error: '先把建议粘贴进来' };
    let entries = null;
    try {
      entries = parseJson(text);
    } catch (err) {
      entries = null;
    }
    if (!entries || !entries.length) entries = parseLabelled(text);
    if (!entries || !entries.length) {
      return {
        ok: false,
        items: [],
        unlocated: 0,
        error: '没有认出建议。每条至少要有「原文」和「问题 / 建议 / 改后」中的一项；也可以直接粘贴 JSON 数组。',
      };
    }
    const items = dedupe(entries.map((entry) => normalise(entry, source)).filter(Boolean));
    if (!items.length) {
      return {
        ok: false,
        items: [],
        unlocated: 0,
        error: '认出了格式，但没有一条同时带着「原文」和「问题 / 建议 / 改后」中的一项。',
      };
    }
    return {
      ok: true,
      items,
      unlocated: items.filter((item) => item.start < 0).length,
      error: '',
    };
  }

  /**
   * R86: the copied prompt carries the chapter, not just the empty format.
   *
   * 「复制格式说明」 used to copy only the skeleton above, so the writer had to
   * paste the chapter and the existing suggestions by hand. The default copy
   * now holds the chapter's full text and every issue already on screen, in
   * the same labelled shape `parse` reads back — hand it to another model and
   * its answer can come straight back into the column. The bare template stays
   * one button away for a writer who only wants to brief a model.
   */
  function buildPrompt(source, items) {
    const text = String(source == null ? '' : source);
    const list = Array.isArray(items) ? items : [];
    const lines = [
      TEMPLATE,
      '',
      '===== 本章全文（' + text.length + ' 字）=====',
      text || '（当前章节没有内容）',
      '',
      '===== 已有的问题（' + list.length + ' 条，请勿重复）=====',
    ];
    if (!list.length) {
      lines.push('（暂无）');
    } else {
      list.forEach((item, index) => {
        if (index) lines.push('');
        const quote = textOf(item && item.quote);
        const issue = textOf(item && item.issue);
        const why = textOf(item && item.why);
        const advice = textOf(item && item.advice);
        const example = textOf(item && item.example);
        const kind = textOf(item && item.kind);
        const severity = textOf(item && item.severity);
        lines.push('原文：' + quote);
        if (issue) lines.push('问题：' + issue);
        if (why) lines.push('理由：' + why);
        if (advice) lines.push('建议：' + advice);
        if (example) lines.push('改后：' + example);
        if (kind) lines.push('类型：' + kind);
        if (severity) lines.push('严重度：' + severity);
      });
    }
    lines.push('');
    lines.push('请只补充上面没有的新问题；如果本章已经没有值得改的地方，直接说「没有了」。');
    return lines.join('\n');
  }

  NS.advicePaste = {
    parse,
    buildPrompt,
    TEMPLATE,
    /** Exposed for the build gate, which checks aliases without a browser. */
    kinds: Array.from(new Set(KIND_ALIASES.values())).sort(),
  };
})();
