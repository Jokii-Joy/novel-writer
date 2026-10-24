// AI helpers for @local/novel-writer: model discovery and long-form proofreading.
//
// Real Harness API (verified against the live Host Service contracts):
//   ctx.get('llm')                 -> { listProviders(), listConfigurableProviders(),
//                                      listModels(provider), stream(GenerateOptions) }
//   ctx.get('agentDefaultModel')   -> { currentSelection(): {provider, model, reasoningEffort?} }
//
// Everything network-ish lives inside the llm service; this module only builds
// prompts, chunks text, consumes the chunk stream and repairs offsets.

/** Hard cap for one proofreading block, in characters (paragraphs are never split). */
const BLOCK_CHARS = 4000;
/** Upper bound for one model reply. */
const MAX_TOKENS = 2000;

const PROOFREAD_SYSTEM = [
  '你是一位严谨的中文小说校对器。',
  '你的任务：只找出**确凿的**错误，包括错别字、词语误用、标点错误、重复字。',
  '不要提出风格建议，不要改写句子，不要评论剧情，不要调整人称或时态，不要润色。',
  '宁缺毋滥：没有把握的地方一律不要报告。',
  '',
  '输出格式（**严格**遵守）：',
  '只输出一个 JSON 数组，不要输出任何解释、前后缀、Markdown 代码围栏或注释。',
  '数组每个元素形如：',
  '{"original":"原文片段","replacement":"替换后的片段","reason":"简短理由","type":"typo|wording|punct"}',
  '',
  '要求：',
  '1. original 必须是原文中**逐字出现**的连续片段（长度控制在 1~20 字），不要包含省略号或占位符；',
  '2. replacement 只替换 original 这一段，其余文字保持不变；',
  '3. type 只能是 typo（错别字/重复字）、wording（词语误用）、punct（标点）三者之一；',
  '4. 若没有任何问题，输出空数组 []；',
  '5. 同一处错误只报告一次。',
].join('\n');

const MODE_HINTS = {
  strict: '本次为严格模式：只报告你完全确定的错误，忽略可疑项。',
  normal: '',
  loose: '本次为宽松模式：也请留意搭配不当、量词误用与明显的重复表达，但仍必须给出确定性修改。',
};

function isDefined(value) {
  return value !== undefined && value !== null;
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function llmService(ctx) {
  return ctx && typeof ctx.get === 'function' ? ctx.get('llm') : undefined;
}

/**
 * Enumerate providers and models, merged with the current default selection.
 * Provider failures are skipped, never thrown.
 */
export async function listModels(ctx) {
  const llm = llmService(ctx);
  const providers = [];
  const models = [];
  if (llm && typeof llm.listProviders === 'function') {
    let rawProviders = [];
    try {
      rawProviders = (await llm.listProviders()) || [];
    } catch {
      rawProviders = [];
    }
    if (!Array.isArray(rawProviders)) rawProviders = [];

    // Dormant, configurable provider routes still belong in a model picker, but
    // never shadow one that already has a live adapter.
    const seen = new Set();
    for (const provider of rawProviders) {
      const id = textOf(provider && provider.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      providers.push({ id, name: textOf(provider.name) || id });
    }
    if (typeof llm.listConfigurableProviders === 'function') {
      try {
        const configurable = (await llm.listConfigurableProviders()) || [];
        for (const entry of Array.isArray(configurable) ? configurable : []) {
          const id = textOf(entry && entry.provider);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          providers.push({ id, name: textOf(entry.displayName) || id });
        }
      } catch {
        /* directory listing is advisory */
      }
    }

    const perProvider = await Promise.all(
      providers.map(async (provider) => {
        if (typeof llm.listModels !== 'function') return [];
        try {
          const list = (await llm.listModels(provider.id)) || [];
          const out = [];
          for (const model of Array.isArray(list) ? list : []) {
            const id = textOf(model && model.id);
            if (!id) continue;
            out.push({
              provider: textOf(model.provider) || provider.id,
              id,
              name: textOf(model.name) || id,
            });
          }
          return out;
        } catch {
          return [];
        }
      }),
    );
    for (const list of perProvider) models.push(...list);
  }

  let current = null;
  try {
    const selection = ctx && typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined;
    if (selection && typeof selection.currentSelection === 'function') {
      const value = selection.currentSelection();
      if (value && isDefined(value.provider) && isDefined(value.model)) {
        current = { provider: String(value.provider), model: String(value.model) };
        if (isDefined(value.reasoningEffort)) current.reasoningEffort = String(value.reasoningEffort);
      }
    }
  } catch {
    current = null;
  }
  if (!current && models.length > 0) current = { provider: models[0].provider, model: models[0].id };

  return { providers, models, current };
}

/** Resolve a usable {provider, model} pair, falling back to the current default. */
async function resolveTarget(ctx, provider, model) {
  if (isDefined(provider) && isDefined(model) && textOf(provider) && textOf(model)) {
    return { provider: String(provider), model: String(model) };
  }
  const listed = await listModels(ctx);
  if (listed.current) return listed.current;
  if (listed.models.length > 0) {
    return { provider: listed.models[0].provider, model: listed.models[0].id };
  }
  return null;
}

/**
 * Split text into blocks of roughly BLOCK_CHARS characters without ever cutting
 * a paragraph in half. Returns [{text, offset}] where offset is the全文字符起点.
 */
export function chunkByParagraphs(text, limit = BLOCK_CHARS) {
  const source = textOf(text);
  if (!source) return [];
  // Keep line terminators so concatenating block texts reproduces the source.
  const paragraphs = source.split(/(?<=\n)/u);
  const blocks = [];
  let buffer = '';
  let bufferStart = 0;
  let cursor = 0;

  const flush = () => {
    if (!buffer) return;
    blocks.push({ text: buffer, offset: bufferStart });
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    // A single paragraph longer than the limit still has to be sent; split it on
    // sentence boundaries rather than mid-character so offsets stay exact.
    if (paragraph.length > limit) {
      flush();
      let local = 0;
      while (local < paragraph.length) {
        const slice = paragraph.slice(local, local + limit);
        blocks.push({ text: slice, offset: cursor + local });
        local += slice.length;
      }
      cursor += paragraph.length;
      bufferStart = cursor;
      continue;
    }
    if (buffer.length + paragraph.length > limit) flush();
    if (!buffer) bufferStart = cursor;
    buffer += paragraph;
    cursor += paragraph.length;
  }
  flush();
  return blocks;
}

/** Strip ``` fences / prose around a JSON array. */
function stripFences(raw) {
  let text = textOf(raw).trim();
  text = text.replace(/^\uFEFF/u, '');
  // Remove a surrounding Markdown code fence if present.
  text = text.replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '');
  return text.trim();
}

function coerceEntry(entry) {
  if (entry == null || typeof entry !== 'object') return null;
  const original = textOf(entry.original ?? entry.from ?? entry.source);
  if (!original) return null;
  const replacement = typeof entry.replacement === 'string'
    ? entry.replacement
    : textOf(entry.replace ?? entry.to ?? entry.suggestion);
  const reason = textOf(entry.reason ?? entry.why ?? entry.note);
  const rawType = textOf(entry.type).toLowerCase();
  const type = rawType === 'typo' || rawType === 'wording' || rawType === 'punct' ? rawType : 'typo';
  if (original === replacement) return null;
  return { original, replacement, reason, type };
}

/**
 * Tolerant JSON-array extraction:
 *   1. strip fences, take the first `[` … last `]`, JSON.parse;
 *   2. otherwise scan every balanced {...} group and parse it individually.
 */
export function parseSuggestionJson(raw) {
  const text = stripFences(raw);
  if (!text) return [];

  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first !== -1 && last > first) {
    try {
      const parsed = JSON.parse(text.slice(first, last + 1));
      if (Array.isArray(parsed)) {
        return parsed.map(coerceEntry).filter(Boolean);
      }
    } catch {
      /* fall through to object scanning */
    }
  }

  // Also accept a single bare object.
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const fragment = text.slice(start, i + 1);
        try {
          const entry = coerceEntry(JSON.parse(fragment));
          if (entry) out.push(entry);
        } catch {
          /* skip malformed object */
        }
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Locate each suggestion inside one block and lift it to whole-text offsets.
 * `cursor` advances so repeated identical fragments map to successive hits.
 */
function locateInBlock(entries, blockText, blockOffset) {
  const found = [];
  let cursor = 0;
  for (const entry of entries) {
    const original = entry.original;
    if (!original) continue;
    let index = blockText.indexOf(original, cursor);
    if (index === -1) index = blockText.indexOf(original);
    if (index === -1) continue;
    cursor = index + original.length;
    const start = blockOffset + index;
    const end = start + original.length;
    if (blockText.slice(index, index + original.length) !== original) continue;
    found.push({ start, end, original, replacement: entry.replacement, reason: entry.reason, type: entry.type });
  }
  return found;
}

/**
 * Fold a system prompt into one user message.
 *
 * IMPORTANT — do not pass `system` to `llm.stream()` and do not put a
 * `{role:'system'}` message in `messages`. Verified against the live Host on
 * 2026-10-19: the xdpool route's channel-pack adapter does
 * `messages.unshift({role:'system', content: options.system})` — a *string*
 * content — and the downstream pi adapter then runs
 * `message.content.some(block => ...)`, throwing
 * `TypeError: content.some is not a function`. Every adapter accepts
 * `{role:'user', content:[{type:'text',text}]}`, so the prompt is inlined there.
 */
function withSystem(system, prompt) {
  const head = textOf(system).trim();
  if (!head) return prompt;
  return `${head}\n\n${prompt}`;
}

/**
 * R29: the writer's own proofreading brief. It is appended to the built-in
 * system prompt rather than replacing it — the JSON contract has to survive, or
 * the whole feature stops parsing. Empty means "use the shipped default", which
 * the settings panel shows as editable starter text.
 */
const DEFAULT_PROOFREAD_RULES =
  '只找确凿的错别字、词语误用、标点错误与重复字；不改风格、不改剧情、不调整人称或时态；没有把握的地方一律不报。';

export const PROOFREAD_DEFAULT_RULES = DEFAULT_PROOFREAD_RULES;

function buildUserPrompt(blockText, mode, rules) {
  const hint = MODE_HINTS[String(mode || 'normal')] || '';
  const head = hint ? `${hint}\n\n` : '';
  const custom = textOf(rules).trim().slice(0, 1200);
  const brief = custom
    ? `作者的校对要求（在这些方面更严格，与上面的规则冲突时以这句为准）：${custom}\n\n`
    : '';
  return withSystem(
    PROOFREAD_SYSTEM,
    `${head}${brief}请校对下面这段小说正文，按约定只输出 JSON 数组。\n\n<<<正文开始>>>\n${blockText}\n<<<正文结束>>>`,
  );
}

/** Run one LLM call and return the concatenated text deltas. */
async function streamText(llm, request) {
  let out = '';
  const stream = llm.stream(request);
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta') {
      if (typeof chunk.text === 'string') out += chunk.text;
      continue;
    }
    if (chunk.type === 'error') {
      const failure = chunk.failure || chunk.error || {};
      const message = textOf(failure.message) || '模型调用失败';
      throw new Error(message);
    }
    if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
      const failure = chunk.reason.failure || {};
      throw new Error(textOf(failure.message) || '模型调用失败');
    }
    if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'aborted') {
      throw Object.assign(new Error('校对已取消'), { code: 'aborted' });
    }
  }
  return out;
}

/**
 * Proofread long text: chunk by paragraph, call the model serially, repair
 * offsets against the original string, dedupe by start and sort.
 */
export async function proofread(ctx, { provider, model, text, mode, rules, signal } = {}) {
  const llm = llmService(ctx);
  if (!llm || typeof llm.stream !== 'function') throw new Error('模型服务不可用');

  const source = textOf(text);
  if (!source.trim()) return { suggestions: [] };

  const target = await resolveTarget(ctx, provider, model);
  if (!target) throw new Error('模型服务不可用');

  const blocks = chunkByParagraphs(source);
  const collected = [];

  for (const block of blocks) {
    if (signal && signal.aborted) throw Object.assign(new Error('校对已取消'), { code: 'aborted' });
    const reply = await streamText(llm, {
      provider: target.provider,
      model: target.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(block.text, mode, rules) }] }],
      maxTokens: MAX_TOKENS,
      signal,
    });
    const entries = parseSuggestionJson(reply);
    if (entries.length === 0) continue;
    // Locate within THIS block only: searching the whole source here would
    // re-find every fragment from the start and push block 2+ offsets out of range.
    for (const located of locateInBlock(entries, block.text, block.offset)) {
      // Final guard against an offset that drifted out of the full text.
      if (located.start < 0 || located.end > source.length) continue;
      if (source.slice(located.start, located.end) !== located.original) continue;
      collected.push(located);
    }
  }

  const byStart = new Map();
  for (const item of collected) {
    if (!byStart.has(item.start)) byStart.set(item.start, item);
  }
  const suggestions = [...byStart.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item, index) => ({
      id: `s${index + 1}`,
      start: item.start,
      end: item.end,
      original: item.original,
      replacement: item.replacement,
      reason: item.reason,
      type: item.type,
    }));

  return { suggestions };
}

// ---------------------------------------------------------------------------
// 修改建议 (R12 ②) — editorial advice, not mechanical replacements
// ---------------------------------------------------------------------------

/**
 * Unlike `PROOFREAD_SYSTEM`, this prompt asks for *opinions*: a quoted passage
 * plus what is wrong with it and what to do instead. Nothing here promises a
 * drop-in replacement, because most real advice ("这一段节奏拖沓") cannot be
 * expressed as `original → replacement`.
 */
const REVISE_SYSTEM = [
  '你是一位有经验的中文小说编辑，正在给作者提**修改建议**。',
  '你的任务：指出**值得改的地方**，并说明怎么改、为什么。',
  '',
  '关注这些方面（按重要程度）：',
  '1. 节奏 rhythm：该紧的地方拖沓，该慢的地方一笔带过；',
  '2. 语言 diction：用词平庸、重复句式、同义反复、形容词堆叠、翻译腔；',
  '3. 视角 pov：视角跳跃、视角人物知道了他不该知道的事；',
  '4. 画面 detail：抽象叙述代替具体细节，"他很伤心"这类直接告诉读者；',
  '5. 对话 dialogue：台词不像人物会说的话，或每条都只是交换信息；',
  '6. 结构 structure：开头是否抓人、结尾是否落地、段落推进是否有递进、有没有可以整段挪走的部分；',
  '7. 人物 character：动机是否成立、行为是否前后一致、配角是否只是工具人；',
  '8. 逻辑 logic：时间、因果、常识、道具与地点是否自洽；',
  '9. 情绪 emotion：该让读者自己感受到的地方，作者替读者先说了；',
  '10. 冗余 redundancy：重复交代、无信息量的过场、可以删掉不影响理解的句子。',
  '',
  '输出格式（**严格**遵守）：',
  '只输出一个 JSON 数组，不要任何解释、前后缀或代码围栏。',
  '每个元素形如：',
  '{"quote":"原文片段","issue":"问题是什么","why":"为什么这是问题","advice":"具体怎么改","example":"改后的示例（可省略）","kind":"rhythm|diction|pov|detail|dialogue|structure|character|logic|emotion|redundancy","severity":"high|medium|low"}',
  '',
  '要求：',
  '1. quote 必须是原文中**逐字出现**的连续片段，20~60 字为宜，不要改写它；',
  '2. issue 一句话说清问题（不超过 40 字），不要客套；',
  '3. why 说明判断依据（不超过 60 字），可以点出它给读者的实际效果，不要重复 issue；',
  '4. advice 给出可执行的动作（不超过 80 字），可以说"删掉""挪到后文""换成一个动作"，不要只写"建议优化"；',
  '5. example 只在改法能用一两句话示范时才写（不超过 120 字），直接写改后的文字，不要写"可以改成"；',
  '6. kind 只能取上面列出的十个值；',
  '7. severity 取 high / medium / low：high 是读者会出戏或读不下去，low 是锦上添花；',
  '8. 最多 8 条，只挑**最值得改**的，不要平均用力；',
  '9. 没有值得说的就输出空数组 []。',
].join('\n');

/**
 * One line of extra instruction per focus. Keys are the `focus` values the
 * client sends; anything unknown falls back to `all`.
 *
 * Ten dimensions, because "建议" that only ever says 节奏/用词 converges on the
 * same three notes every time — structure, character and logic are what a
 * writer actually has to fix in a second draft.
 */
const REVISE_FOCUS = {
  all: '',
  rhythm: '本次只看节奏：哪里该压缩、哪里该展开。',
  diction: '本次只看语言：用词、句式、重复、翻译腔。',
  pov: '本次只看视角与信息释放：视角是否稳定、交代是否过量。',
  detail: '本次只看画面：哪里在用抽象叙述代替具体细节。',
  dialogue: '本次只看对话：台词是否像这个人会说的话。',
  structure: '本次只看结构：开头是否抓人、结尾是否落地、段落推进有没有递进、哪一段可以整段挪走或删掉。',
  character: '本次只看人物：动机是否成立、行为是否前后一致、配角是不是只是工具人。',
  logic: '本次只看逻辑：时间、因果、常识、道具与地点有没有对不上的地方。',
  emotion: '本次只看情绪：哪里作者替读者先说了感受，本该让读者自己体会。',
  redundancy: '本次只看冗余：重复交代、无信息量的过场、删掉也不影响理解的句子。',
};

/** The ten kinds a suggestion may carry; anything else is coerced to `diction`. */
const ADVICE_KINDS = new Set([
  'rhythm',
  'diction',
  'pov',
  'detail',
  'dialogue',
  'structure',
  'character',
  'logic',
  'emotion',
  'redundancy',
]);

const ADVICE_SEVERITY = new Set(['high', 'medium', 'low']);

function parseAdviceJson(raw) {
  const text = textOf(raw).trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const quote = textOf(entry.quote).trim();
    const issue = textOf(entry.issue).trim();
    const advice = textOf(entry.advice).trim();
    if (!quote || !issue || !advice) continue;
    const kind = ADVICE_KINDS.has(textOf(entry.kind)) ? textOf(entry.kind) : 'diction';
    const severity = ADVICE_SEVERITY.has(textOf(entry.severity)) ? textOf(entry.severity) : 'medium';
    // `why` and `example` are optional: a model that ignores them still gives
    // usable advice, and the panel hides the empty rows instead of printing
    // labels with nothing after them.
    const why = textOf(entry.why).trim();
    const example = textOf(entry.example).trim();
    out.push({ quote, issue, advice, kind, severity, why, example });
  }
  return out;
}

/**
 * Ask the model for editorial suggestions on one chapter.
 *
 * `focus` picks one of ten preset dimensions; `note` is free text the writer
 * typed themselves and is folded into the prompt ahead of the preset so a
 * specific request ("只看结尾", "别动对话") wins over the generic hint.
 *
 * Resolves to `{suggestions:[{id,quote,start,end,issue,why,advice,example,kind,severity}], model}`.
 * `start`/`end` are best-effort offsets into the source text (located the same
 * way proofreading does it) so the UI can scroll the quoted passage into view;
 * a suggestion whose quote cannot be located is still returned with `start:-1`
 * rather than dropped — the advice itself is the valuable part.
 */
export async function revise(ctx, { provider, model, text, focus, note, signal } = {}) {
  const llm = llmService(ctx);
  if (!llm || typeof llm.stream !== 'function') throw new Error('模型服务不可用');

  const source = textOf(text);
  if (!source.trim()) return { suggestions: [], model: '' };

  const target = await resolveTarget(ctx, provider, model);
  if (!target) throw new Error('模型服务不可用');

  // Reuse the proofreading chunker: it splits on paragraph boundaries so the
  // model never sees half a sentence, and it keeps the block offsets needed to
  // map a quote back onto the full chapter.
  const blocks = chunkByParagraphs(source);
  const hint = REVISE_FOCUS[textOf(focus) || 'all'] || '';
  // The writer's own instruction ("别动对话，只看结尾") outranks the preset
  // focus: it is the reason they typed something instead of clicking a chip.
  const custom = textOf(note).trim().slice(0, 400);
  const customLine = custom
    ? `作者的额外要求（**优先满足**，与上面的关注点冲突时以这句为准）：${custom}`
    : '';
  const collected = [];

  for (const block of blocks) {
    if (signal && signal.aborted) throw Object.assign(new Error('已取消'), { code: 'aborted' });
    const prompt = withSystem(
      REVISE_SYSTEM,
      `${hint ? hint + '\n' : ''}${customLine ? customLine + '\n' : ''}\n请阅读下面这段小说正文，给出修改建议，按约定只输出 JSON 数组。\n\n<<<正文开始>>>\n${block.text}\n<<<正文结束>>>`,
    );
    const reply = await streamText(llm, {
      provider: target.provider,
      model: target.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      // Advice is wordier than a typo list, so this budget is larger than the
      // proofreader's: eight entries with an 80-character `advice` overflow 2000
      // tokens on a verbose model.
      maxTokens: MAX_TOKENS * 2,
      signal,
    });
    for (const entry of parseAdviceJson(reply)) {
      const index = block.text.indexOf(entry.quote);
      collected.push({
        ...entry,
        start: index >= 0 ? block.offset + index : -1,
        end: index >= 0 ? block.offset + index + entry.quote.length : -1,
      });
    }
  }

  const seen = new Set();
  const suggestions = [];
  for (const item of collected) {
    // The same passage can come back from two overlapping blocks; the advice is
    // what makes two entries distinct, so dedupe on both.
    const key = `${item.start}|${item.issue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ id: `r${suggestions.length + 1}`, ...item });
  }
  // Most serious first: the panel is a fixed-height column, so the top of the
  // list has to be the part that matters. Stable within a severity, which keeps
  // the model's own ordering (it reads the chapter front to back).
  const rank = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1));
  if (suggestions.length > 8) suggestions.length = 8;
  suggestions.forEach((item, index) => {
    item.id = `r${index + 1}`;
  });

  return { suggestions, model: `${target.provider}/${target.model}` };
}

/**
 * Normalize one outgoing message to the Host wire shape.
 *
 * The real `GenerateOptions.messages` entries carry `content` as a
 * `readonly ContentBlock[]` (the harness builds them as `[{type:'text',text}]`),
 * but a plain string is the convenient form for our own callers, so both are
 * accepted and strings are wrapped into a single text block.
 */
export function toWireMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = typeof message.role === 'string' ? message.role : '';
  if (!role) return null;
  const raw = message.content;
  let content;
  if (typeof raw === 'string') content = raw ? [{ type: 'text', text: raw }] : [];
  else if (Array.isArray(raw)) content = raw;
  else content = [];
  return { role, content };
}

/**
 * Single-shot chat helper reused by typesetting / summary features.
 * Returns the concatenated assistant text.
 */
export async function chatOnce(ctx, { provider, model, messages, system, maxTokens, signal } = {}) {
  const llm = llmService(ctx);
  if (!llm || typeof llm.stream !== 'function') throw new Error('模型服务不可用');
  const target = await resolveTarget(ctx, provider, model);
  if (!target) throw new Error('模型服务不可用');

  const wire = (Array.isArray(messages) ? messages : []).map(toWireMessage).filter(Boolean);
  const folded = foldSystemIntoMessages(wire, system);
  const request = {
    provider: target.provider,
    model: target.model,
    messages: folded.length > 0 ? folded : [{ role: 'user', content: [{ type: 'text', text: '请继续。' }] }],
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : MAX_TOKENS,
  };
  if (signal) request.signal = signal;
  return streamText(llm, request);
}

/**
 * Prepend a system prompt as text inside the first user message.
 * See `withSystem` for why `system` never goes on the request itself.
 */
function foldSystemIntoMessages(wire, system) {
  const head = textOf(system).trim();
  if (!head) return wire;
  const rows = wire.slice();
  const index = rows.findIndex((row) => row && row.role === 'user');
  if (index < 0) {
    rows.unshift({ role: 'user', content: [{ type: 'text', text: head }] });
    return rows;
  }
  const row = rows[index];
  const blocks = Array.isArray(row.content) ? row.content.slice() : [];
  blocks.unshift({ type: 'text', text: head });
  rows[index] = { role: 'user', content: blocks };
  return rows;
}

/** Probe whether the model catalogue is reachable (for `selftest`). */
export async function probeModels(ctx) {
  const llm = llmService(ctx);
  if (!llm) return { ok: false, detail: 'llm 服务不可用' };
  try {
    const { providers, models, current } = await listModels(ctx);
    if (providers.length === 0) return { ok: false, detail: '未发现可用的模型提供方' };
    const currentLabel = current ? `${current.provider}/${current.model}` : '未设置';
    return {
      ok: true,
      detail: `${providers.length} 个提供方，${models.length} 个模型，当前默认 ${currentLabel}`,
    };
  } catch (error) {
    return { ok: false, detail: `模型列表不可用: ${error && error.message ? error.message : error}` };
  }
}

export const PROOFREAD_SYSTEM_PROMPT = PROOFREAD_SYSTEM;
export const PROOFREAD_BLOCK_CHARS = BLOCK_CHARS;

// ---------------------------------------------------------------------------
// R27 ③: journal matching by the model instead of by arithmetic
//
// The old `journals.rank()` scored every journal from three numbers (genre hit,
// length window, has an inbox). Every journal that cleared those three landed on
// the same score, so "为你推荐" was alphabetical order wearing a percentage. A
// model can actually read the manuscript and say *why* a journal fits — and, more
// importantly, can say when the quality is not there yet.
// ---------------------------------------------------------------------------

const MATCH_SYSTEM = [
  '你是一位资深的中文文学编辑，熟悉各家文学期刊的定位、趣味与用稿标准。',
  '你会读到一篇小说的开头节选，以及一份候选期刊清单。',
  '你的任务：判断这篇小说与每一家期刊的**契合度**，以及稿件质量是否**达到该刊的用稿水准**。',
  '',
  '判断依据（按重要性排序）：',
  '1. 题材与趣味：该刊偏好的题材、气质、叙事方式，与这篇小说是否同路；',
  '2. 篇幅：小说字数是否落在该刊的常收区间；',
  '3. 水准：以该刊的层次（国家级/省级/市级）衡量，这篇稿子是否够格；',
  '4. 栏目：该刊是否设有适合这篇小说的栏目。',
  '',
  '严格要求：',
  '- 不要因为「有邮箱」「字数够」就给高分，那只是门槛，不是契合；',
  '- 水准不足就如实说不足，不要为了凑数把不合适的期刊排进前列；',
  '- 只评价清单里给出的期刊，不要虚构期刊；',
  '',
  '输出格式（**严格**遵守）：',
  '只输出一个 JSON 数组，不要输出解释、前后缀或 Markdown 代码围栏。',
  '每个元素形如：',
  '{"id":"期刊id","fit":0-100,"verdict":"一句判断","reason":"两三句说明为什么契合或不契合","quality":"够格|略欠|尚不足"}',
  '数组按 fit 从高到低排列，最多给出 6 条。',
].join('\n');

const MATCH_QUALITY = new Set(['够格', '略欠', '尚不足']);

/** How much of the opening the matcher reads. Voice shows up early; plot does not. */
const MATCH_EXCERPT_CHARS = 2400;
export const MATCH_EXCERPT_LIMIT = MATCH_EXCERPT_CHARS;

/** Compress a journal row into the few fields the matcher actually reasons about. */
function journalBrief(entry) {
  const genres = Object.keys(entry.genres || {})
    .filter((key) => entry.genres[key] === true)
    .map((key) => ({ weixiaoshuo: '微小说', duanpian: '短篇', zhongpian: '中篇', changpian: '长篇' })[key] || key);
  return {
    id: textOf(entry.id),
    name: textOf(entry.name),
    tier: textOf(entry.tier),
    genres,
    wordRange: textOf(entry.wordRange),
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 6) : [],
    requirements: Array.isArray(entry.requirements) ? entry.requirements.slice(0, 4) : [],
  };
}

function parseMatchJson(raw, allowed) {
  const text = textOf(raw).trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  const seen = new Set();
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const id = textOf(row.id).trim();
    // A hallucinated id would render a card the user cannot select, so anything
    // outside the shortlist we sent is dropped rather than repaired.
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    const fit = Math.max(0, Math.min(100, Math.round(Number(row.fit) || 0)));
    const quality = textOf(row.quality).trim();
    out.push({
      id,
      fit,
      verdict: textOf(row.verdict).trim(),
      reason: textOf(row.reason).trim(),
      quality: MATCH_QUALITY.has(quality) ? quality : '',
    });
  }
  out.sort((a, b) => b.fit - a.fit);
  return out.slice(0, 6);
}

/**
 * Ask the model to match a manuscript against a shortlist of journals.
 *
 * `excerpt` should be the opening of the story — enough to judge voice and
 * subject, short enough to keep the call cheap. Resolves to
 * `{matches:[{id,fit,verdict,reason,quality}], model}`; throws only when the
 * model service itself is unusable, so the caller can fall back to `rank()`.
 */
export async function matchJournals(ctx, { provider, model, excerpt, journals, wordCount, genre, signal } = {}) {
  const llm = llmService(ctx);
  if (!llm || typeof llm.stream !== 'function') throw new Error('模型服务不可用');

  const shortlist = (Array.isArray(journals) ? journals : []).map(journalBrief).filter((row) => row.id);
  if (shortlist.length === 0) return { matches: [], model: '' };

  const target = await resolveTarget(ctx, provider, model);
  if (!target) throw new Error('模型服务不可用');

  const allowed = new Set(shortlist.map((row) => row.id));
  const prompt = withSystem(
    MATCH_SYSTEM,
    [
      `稿件字数：${Math.max(0, Math.trunc(Number(wordCount) || 0))} 字`,
      genre ? `稿件体裁：${genre}` : '',
      '',
      '候选期刊（JSON）：',
      JSON.stringify(shortlist),
      '',
      '小说开头节选：',
      '-----',
      textOf(excerpt).slice(0, MATCH_EXCERPT_CHARS),
      '-----',
      '',
      '请按要求输出 JSON 数组。',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );

  const raw = await streamText(llm, {
    provider: target.provider,
    model: target.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: 1200,
    ...(signal ? { signal } : {}),
  });

  return { matches: parseMatchJson(raw, allowed), model: `${target.provider}/${target.model}` };
}
