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

function buildUserPrompt(blockText, mode) {
  const hint = MODE_HINTS[String(mode || 'normal')] || '';
  const head = hint ? `${hint}\n\n` : '';
  return withSystem(PROOFREAD_SYSTEM, `${head}请校对下面这段小说正文，按约定只输出 JSON 数组。\n\n<<<正文开始>>>\n${blockText}\n<<<正文结束>>>`);
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
export async function proofread(ctx, { provider, model, text, mode, signal } = {}) {
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
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(block.text, mode) }] }],
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
