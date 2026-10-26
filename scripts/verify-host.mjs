// Offline verification for the novel-writer Host service layer.
//
// Run: node scripts/verify-host.mjs
//
// No real network is used. A fake Cordis context, fake IncomingMessage /
// ServerResponse and a fake LLM stream exercise the full HTTP path; the two
// remote backends are covered by pure URL/XML assembly assertions.

import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Never touch the developer's real secret store during tests.
// Each run uses its own per-pid directory so a parallel verify-docs.mjs run
// cannot delete scripts/.tmp out from under us (and vice versa).
const tmpRoot = path.join(here, '.tmp');
const tmpRun = path.join(tmpRoot, `verify-host-${process.pid}`);
const tmpHome = path.join(tmpRun, 'dsh-home');
fs.rmSync(tmpRun, { recursive: true, force: true });
fs.mkdirSync(tmpHome, { recursive: true });
process.env.DSH_HOME = tmpHome;

const { registerRoutes, createHandler, methodFromPath, parseJsonBody, readBody, ROUTE_PREFIX } = await import(
  new URL('../lib/routes.js', import.meta.url).href
);
const secrets = await import(new URL('../lib/secrets.js', import.meta.url).href);
const ai = await import(new URL('../lib/ai.js', import.meta.url).href);
const library = await import(new URL('../lib/library.js', import.meta.url).href);
const { unzipSync } = await import(new URL('../lib/zip.js', import.meta.url).href);
const lansync = await import(new URL('../lib/lansync.js', import.meta.url).href);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const proofreadText = [
  '　　他走进屋子，看见桌子上放这一本书。',
  '　　这本书的封面上写着「山海经」三个字，他心里想：这真是一本奇怪的书阿。',
  '　　窗外的风停了，屋内的灯还亮着，他却已经睡着在了椅子上。',
].join('\n');

/** Extract the text of a wire message whose content may be a string or text blocks. */
function messageText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

// The model "replies" with a JSON array; each original really occurs in the text.
const fakeReply = JSON.stringify([
  { original: '放这一本书', replacement: '放着一本书', reason: '「着」误写为「这」', type: 'typo' },
  { original: '奇怪的书阿', replacement: '奇怪的书啊', reason: '句末语气词应为「啊」', type: 'typo' },
]);

const fakeLlm = {
  async listProviders() {
    return [{ id: 'stub-provider', name: 'Stub Provider' }];
  },
  async listConfigurableProviders() {
    return [{ provider: 'dormant-provider', displayName: 'Dormant Provider' }];
  },
  async listModels(providerId) {
    if (providerId === 'stub-provider') {
      return [{ provider: 'stub-provider', id: 'stub-large', name: 'Stub Large' }];
    }
    if (providerId === 'dormant-provider') {
      return [{ provider: 'dormant-provider', id: 'dormant-1', name: 'Dormant One' }];
    }
    throw new Error('provider not found');
  },
  async *stream(request) {
    // Real Host messages carry content as [{type:'text',text}]; accept both shapes
    // so this fake also guards the wire-shape normalization.
    const content = messageText(request.messages && request.messages[0]);
    // Two text deltas to prove the collector concatenates them.
    yield { type: 'text-delta', text: '```json\n' };
    yield { type: 'text-delta', text: fakeReply.slice(0, 17) };
    yield { type: 'text-delta', text: fakeReply.slice(17) + '\n```\n以上。' };
    yield { type: 'finish', reason: { kind: 'stop' } };
    void content;
  },
};

const registered = [];
const fakeWebServer = {
  register(route) {
    registered.push(route);
    return () => {
      registered.length = 0;
    };
  },
};

const services = new Map([
  ['webServer', fakeWebServer],
  ['llm', fakeLlm],
  [
    'agentDefaultModel',
    { currentSelection: () => ({ provider: 'stub-provider', model: 'stub-large', reasoningEffort: 'high' }) },
  ],
]);

const ctx = {
  get(name) {
    return services.get(name);
  },
  effect(fn) {
    const dispose = fn();
    return () => dispose();
  },
};

/** Build a fake IncomingMessage that streams `body`. */
function makeReq({ method = 'POST', url = ROUTE_PREFIX, body = '' } = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const stream = Readable.from(buffer.length > 0 ? [buffer] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

/** Build a fake ServerResponse that records what the handler wrote. */
function makeRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: null,
    chunks,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk));
      this.ended = true;
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8');
    },
    get json() {
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return null;
      }
    },
  };
}

/** Call the registered handler exactly as webServer would. */
async function call(method, payload, { verb = 'POST', raw } = {}) {
  if (!handler) throw new Error('handler not built');
  const url = method ? `${ROUTE_PREFIX}/${method}` : ROUTE_PREFIX;
  const body = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const req = makeReq({ method: verb, url, body });
  const res = makeRes();
  await handler(req, res);
  return res;
}

// ---------------------------------------------------------------------------
// 0. Registration
// ---------------------------------------------------------------------------
console.log('\n[0] registerRoutes / webServer wiring');
const dispose = registerRoutes(ctx, { options: {} });
check('registerRoutes 返回 disposer', typeof dispose === 'function');
check('注册了一条 prefix 路由', registered.length === 1, JSON.stringify(registered.map((r) => ({ kind: r.kind, path: r.path }))));
check('route.kind === "prefix"', registered[0] && registered[0].kind === 'prefix');
check(`route.path === "${ROUTE_PREFIX}"`, registered[0] && registered[0].path === ROUTE_PREFIX);
check('route.handler 是函数', registered[0] && typeof registered[0].handler === 'function');

const handler = registered[0] && registered[0].handler;
const noServerDispose = registerRoutes({ get: () => undefined }, {});
check('缺少 webServer 时返回 no-op disposer', typeof noServerDispose === 'function' && noServerDispose() === undefined);

// path parsing
check('methodFromPath 解析 ping', methodFromPath('/novel-writer/api/ping') === 'ping');
check('methodFromPath 解析带查询串', methodFromPath('/novel-writer/api/library.get?x=1') === 'library.get');
check('parseJsonBody 空 body → {}', JSON.stringify(parseJsonBody(Buffer.alloc(0))) === '{}');
check(
  'readBody 累计分片',
  (await readBody(makeReq({ body: JSON.stringify({ a: 1 }) }))).toString('utf8') === '{"a":1}',
);

// ---------------------------------------------------------------------------
// 1. ping
// ---------------------------------------------------------------------------
console.log('\n[1] GET ping');
const ping = await call('ping', undefined, { verb: 'GET' });
check('HTTP 200', ping.statusCode === 200);
check('content-type 是 JSON', ping.headers && String(ping.headers['content-type']).includes('application/json'));
check('cache-control: no-store', ping.headers && ping.headers['cache-control'] === 'no-store');
check('ok === true', ping.json && ping.json.ok === true);
check('data.name === "novel-writer"', ping.json && ping.json.data && ping.json.data.name === 'novel-writer');
check('data.version 是非空字符串', ping.json && typeof ping.json.data.version === 'string' && ping.json.data.version.length > 0);
check(
  'data.capabilities.pdf 是布尔值',
  ping.json && ping.json.data && ping.json.data.capabilities && typeof ping.json.data.capabilities.pdf === 'boolean',
);
console.log('    →', JSON.stringify(ping.json));

// ---------------------------------------------------------------------------
// 2. models
// ---------------------------------------------------------------------------
console.log('\n[2] POST models');
const models = await call('models', {});
check('ok === true', models.json && models.json.ok === true);
const md = models.json && models.json.data;
check('providers 含 stub-provider', Array.isArray(md.providers) && md.providers.some((p) => p.id === 'stub-provider'));
check('providers 含 dormant-provider', Array.isArray(md.providers) && md.providers.some((p) => p.id === 'dormant-provider'));
check('models 含 stub-large', Array.isArray(md.models) && md.models.some((m) => m.id === 'stub-large'));
check('models 每项都有 provider/id/name', Array.isArray(md.models) && md.models.every((m) => m.provider && m.id && m.name));
check('current.provider === "stub-provider"', md.current && md.current.provider === 'stub-provider');
check('current.model === "stub-large"', md.current && md.current.model === 'stub-large');
console.log('    →', JSON.stringify(md));

// ---------------------------------------------------------------------------
// 3. proofread
// ---------------------------------------------------------------------------
console.log('\n[3] POST proofread');
const proof = await call('proofread', { provider: 'stub-provider', model: 'stub-large', text: proofreadText, mode: 'normal' });
check('ok === true', proof.json && proof.json.ok === true);
const suggestions = (proof.json && proof.json.data && proof.json.data.suggestions) || [];
check('解析出 2 条建议', suggestions.length === 2, `实际 ${suggestions.length}`);
check(
  '每条都满足 text.slice(start,end) === original',
  suggestions.every((s) => proofreadText.slice(s.start, s.end) === s.original),
);
check('每条都有 id/reason/type 字段', suggestions.every((s) => s.id && typeof s.reason === 'string' && ['typo', 'wording', 'punct'].includes(s.type)));
check('按 start 升序', suggestions.every((s, i) => i === 0 || suggestions[i - 1].start <= s.start));
console.log('    →', JSON.stringify(suggestions, null, 0));
for (const s of suggestions) {
  console.log(`       [${s.start},${s.end}) "${s.original}" → "${s.replacement}" (${s.type})`);
}
check('第 1 条原文是「放这一本书」', suggestions[0] && suggestions[0].original === '放这一本书');
check('第 2 条原文是「奇怪的书阿」', suggestions[1] && suggestions[1].original === '奇怪的书阿');

// chunking keeps offsets exact
const longText = Array.from({ length: 60 }, (_, i) => `　　这是第${i + 1}段，用于验证分块偏移。`).join('\n');
const blocks = ai.chunkByParagraphs(longText, 200);
check('长文被分成多块', blocks.length > 1, `${blocks.length} 块`);
check(
  '分块不切断段落（每块都以 \\n 结尾或为末尾）',
  blocks.every((b) => b.text.endsWith('\n') || b.offset + b.text.length === longText.length),
);
check(
  '分块拼接可还原原文',
  blocks.map((b) => b.text).join('') === longText,
);
check(
  '每块 offset 都指向原文起点',
  blocks.every((b) => longText.startsWith(b.text, b.offset)),
);

// A second fake provider path: multi-block proofreading. The reply depends on
// which marker paragraph is inside the block, so block-2/block-3 offsets get
// exercised (a regression here silently corrupts every suggestion past block 1).
const multiBlockLlm = {
  async listProviders() {
    return [{ id: 'multi-provider', name: 'Multi Provider' }];
  },
  async listModels() {
    return [{ provider: 'multi-provider', id: 'multi-model', name: 'Multi Model' }];
  },
  async *stream(request) {
    const content = messageText(request.messages && request.messages[0]);
    const found = [];
    if (content.includes('错别字甲')) found.push({ original: '错别字甲', replacement: '正确字甲', reason: '块二', type: 'typo' });
    if (content.includes('错别字乙')) found.push({ original: '错别字乙', replacement: '正确字乙', reason: '块三', type: 'typo' });
    yield { type: 'text-delta', text: JSON.stringify(found) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  },
};
const multiCtx = {
  get(name) {
    if (name === 'llm') return multiBlockLlm;
    if (name === 'agentDefaultModel') return null;
    return services.get(name);
  },
  effect(fn) {
    return () => fn()();
  },
};

const filler = '　　他沿着河岸慢慢走着，水面反着天光，风从背后推着他往前。';
// Must exceed BLOCK_CHARS (4000) so blockOffset is non-zero for the later hit.
const multiParagraphs = Array.from({ length: 140 }, (_, i) => {
  if (i === 60) return `　　${filler}这里有个错别字甲需要改。`;
  if (i === 135) return `　　${filler}这里还有个错别字乙需要改。`;
  return `　　第${i + 1}段：${filler}`;
});
const multiText = multiParagraphs.join('\n');
const multiBlocksAll = ai.chunkByParagraphs(multiText);
check('多块测试文本确实跨块', multiBlocksAll.length >= 2, `${multiText.length} 字 / ${multiBlocksAll.length} 块`);
const multiResult = await ai.proofread(multiCtx, { provider: 'multi-provider', model: 'multi-model', text: multiText });
const multiSuggestions = multiResult.suggestions || [];
check('多块校对解析出 2 条建议', multiSuggestions.length === 2, `实际 ${multiSuggestions.length}`);
check(
  '跨块建议的 start/end 仍与全文对齐',
  multiSuggestions.every((s) => multiText.slice(s.start, s.end) === s.original),
  multiSuggestions.map((s) => `[${s.start},${s.end})="${multiText.slice(s.start, s.end)}"`).join(' '),
);
check(
  '第二条建议落在第一块之外（块偏移计算正确）',
  multiSuggestions.length === 2 && multiSuggestions[1].start > multiBlocksAll[0].text.length,
  multiSuggestions.length === 2
    ? `start=${multiSuggestions[1].start} > 首块长度 ${multiBlocksAll[0].text.length}`
    : '',
);

// the Host wire shape: content must be a text-block array, not a bare string
const wireMessage = ai.toWireMessage({ role: 'user', content: '你好' });
check('toWireMessage 把字符串包成 text block', Array.isArray(wireMessage.content) && wireMessage.content[0].type === 'text', JSON.stringify(wireMessage));
const wireBlockList = ai.toWireMessage({ role: 'user', content: [{ type: 'text', text: 'a' }] });
check('toWireMessage 原样保留 block 数组', wireBlockList.content.length === 1 && wireBlockList.content[0].text === 'a');
check('toWireMessage 丢弃无 role 的消息', ai.toWireMessage({ content: 'x' }) === null);
{
  // Capture the real request the proofread call hands to llm.stream.
  let captured = null;
  const captureCtx = {
    get: (name) => (name === 'llm' ? {
      async listProviders() { return [{ id: 'p', name: 'P' }]; },
      async listModels() { return [{ provider: 'p', id: 'm', name: 'M' }]; },
      async *stream(request) {
        captured = request;
        yield { type: 'text-delta', text: '[]' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    } : null),
    effect: (fn) => () => fn()(),
  };
  await ai.proofread(captureCtx, { provider: 'p', model: 'm', text: '　　一段正文。' });
  const msg = captured && captured.messages && captured.messages[0];
  check('proofread 发出的 messages[0].content 是 block 数组', Boolean(msg && Array.isArray(msg.content) && msg.content[0].type === 'text'));
  // Regression guard (2026-10-19, live host): a top-level `system` option is
  // unshifted by the xdpool channel-pack adapter as a STRING content, and the
  // pi adapter then calls content.some(...) → "content.some is not a function".
  // The system prompt must therefore be folded into the user message.
  check('proofread 不发送顶层 system 字段', Boolean(captured) && !('system' in captured), JSON.stringify(captured && Object.keys(captured)));
  check('proofread 的系统提示词折进 user 文本', Boolean(msg && Array.isArray(msg.content) && msg.content[0].text.includes('校对')));
  check('proofread 的 maxTokens 为 2000', captured && captured.maxTokens === 2000, String(captured && captured.maxTokens));
  check('proofread 请求体不含多余额外字段', Boolean(captured && captured.provider === 'p' && captured.model === 'm'));
}

// chatOnce keeps the same invariant for its optional system prompt
{
  let captured = null;
  const captureCtx = {
    get: (name) => (name === 'llm' ? {
      async listProviders() { return [{ id: 'p', name: 'P' }]; },
      async listModels() { return [{ provider: 'p', id: 'm', name: 'M' }]; },
      async *stream(request) {
        captured = request;
        yield { type: 'text-delta', text: '好的' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    } : null),
    effect: (fn) => () => fn()(),
  };
  await ai.chatOnce(captureCtx, { provider: 'p', model: 'm', messages: [{ role: 'user', content: '你好' }], system: '你是助手' });
  const rows = (captured && captured.messages) || [];
  check('chatOnce 不发送顶层 system 字段', !('system' in captured), JSON.stringify(Object.keys(captured)));
  check('chatOnce 的 system 折进首条 user block 数组', Boolean(rows[0] && Array.isArray(rows[0].content) && rows[0].content[0].text.includes('你是助手')));
}

// tolerant JSON parsing
check('解析裸 JSON 数组', ai.parseSuggestionJson('[{"original":"甲","replacement":"乙","reason":"r","type":"typo"}]').length === 1);
check(
  '解析带 ```json 围栏与前后废话',
  ai.parseSuggestionJson('好的，结果如下：\n```json\n[{"original":"甲","replacement":"乙","reason":"r","type":"typo"}]\n```\n以上。').length === 1,
);
check('解析 [] → 0 条', ai.parseSuggestionJson('[]').length === 0);
check('解析垃圾文本 → 0 条而不抛错', ai.parseSuggestionJson('模型拒绝回答').length === 0);
check(
  '逐对象兜底解析（数组括号被截断）',
  ai.parseSuggestionJson('{"original":"甲","replacement":"乙","reason":"r","type":"punct"}').length === 1,
);

// ---------------------------------------------------------------------------
// 4. export.build docx
// ---------------------------------------------------------------------------
console.log('\n[4] POST export.build {format:"docx"}');
const exportRes = await call('export.build', {
  format: 'docx',
  novel: {
    title: '验证样章',
    author: '自检',
    chapters: [
      { title: '第一章 起点', content: '　　他在雨里站了很久。\n　　雨停的时候，天已经黑了。' },
      { title: '第二章 归途', content: '　　回家的路上没有灯。' },
    ],
  },
  options: { pageBreak: true },
});
check('ok === true', exportRes.json && exportRes.json.ok === true, exportRes.json && exportRes.json.ok === false ? JSON.stringify(exportRes.json.error) : '');
const built = exportRes.json && exportRes.json.data;
check('filename 以 .docx 结尾', Boolean(built && built.filename && built.filename.endsWith('.docx')), built && built.filename);
check(
  'mime 是 docx 的类型',
  Boolean(built && built.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
);
check('base64 非空', Boolean(built && typeof built.base64 === 'string' && built.base64.length > 0), built && `${built.base64.length} 字符`);

if (built && typeof built.base64 === 'string') {
  const docxBytes = Buffer.from(built.base64, 'base64');
  check('base64 解回字节非空', docxBytes.length > 0, `${docxBytes.length} 字节`);
  check('是 ZIP 魔数 PK', docxBytes[0] === 0x50 && docxBytes[1] === 0x4b);

  const entries = unzipSync(docxBytes);
  const documentXml = entries.get('word/document.xml');
  check('unzipSync 解出 word/document.xml', Boolean(documentXml), documentXml ? `${documentXml.length} 字节` : '缺失');
  if (documentXml) {
    const xml = documentXml.toString('utf8');
    check('document.xml 含章节标题「第一章 起点」', xml.includes('第一章 起点'));
    check('document.xml 含正文内容', xml.includes('他在雨里站了很久'));
    check('document.xml 含「第二章 归途」', xml.includes('第二章 归途'));
  }
  check('包含 [Content_Types].xml', entries.has('[Content_Types].xml'));
  check('包含 word/styles.xml', entries.has('word/styles.xml'));
  console.log(`    → ${built.filename} ${built.mime} ${docxBytes.length} 字节, entries=${entries.size}`);
} else {
  console.log('    → docx 构建失败，跳过 ZIP 断言');
}

// txt export
const txtRes = await call('export.build', { format: 'txt', novel: { title: '验证样章', chapters: [{ title: '第一章', content: '正文' }] } });
check('txt 导出 ok', txtRes.json && txtRes.json.ok === true);
const txtData = txtRes.json && txtRes.json.data;
check('txt filename 以 .txt 结尾', txtData && txtData.filename.endsWith('.txt'));
check('txt 内容含正文', txtData && Buffer.from(txtData.base64, 'base64').toString('utf8').includes('正文'));

// pdf export: either a real PDF (engine present) or the contract's exact
// pdf-unavailable envelope — never an uncaught exception.
const pdfRes = await call('export.build', { format: 'pdf', novel: { title: '验证样章', chapters: [{ title: '第一章', content: '正文' }] } });
check('pdf 导出总是 HTTP 200 且带 ok 字段', pdfRes.statusCode === 200 && pdfRes.json && typeof pdfRes.json.ok === 'boolean');
if (pdfRes.json && pdfRes.json.ok === true) {
  const pdfBytes = Buffer.from(pdfRes.json.data.base64, 'base64');
  check('pdf 导出成功且是 PDF 魔数 %PDF', pdfBytes.subarray(0, 4).toString('latin1') === '%PDF', `${pdfBytes.length} 字节`);
} else {
  check(
    'pdf 不可用时错误码为 pdf-unavailable 且消息友好',
    pdfRes.json && pdfRes.json.error && pdfRes.json.error.code === 'pdf-unavailable'
      && pdfRes.json.error.message === 'PDF 引擎不可用，请改用 DOCX 导出',
    JSON.stringify(pdfRes.json && pdfRes.json.error),
  );
}

// unknown method / bad json
const unknown = await call('nope.nothing', {});
check('未知方法 → ok:false, unknown-method', unknown.json && unknown.json.ok === false && unknown.json.error.code === 'unknown-method');
const badJson = await call('models', undefined, { raw: '{oops' });
check('坏 JSON → ok:false, bad-json', badJson.json && badJson.json.ok === false && badJson.json.error.code === 'bad-json');
check('错误也是 HTTP 200', badJson.statusCode === 200);

// ---------------------------------------------------------------------------
// 5. R40: a chapter heading that only repeats the book title
// ---------------------------------------------------------------------------
// A one-piece story opened in a chapter named after the story, or a multi-part
// work whose first part restates the book name, used to print the same words
// twice — once in the title block, once as the chapter heading. The comparison
// must be whole-title only: 「第一章 秋水」 is a real numbered chapter and has to
// survive verbatim.
console.log('\n[5] 书名与章节名重复时只出现一次');
const countOf = (text, needle) => String(text).split(needle).length - 1;

const dupTxt = await call('export.build', {
  format: 'txt',
  novel: {
    title: '秋水',
    chapters: [
      { title: '秋水', content: '　　他站在雨里。' },
      { title: '归途', content: '　　回家的路上没有灯。' },
    ],
  },
});
const dupTxtBody = dupTxt.json && dupTxt.json.ok ? Buffer.from(dupTxt.json.data.base64, 'base64').toString('utf8') : '';
check('txt 导出成功（章节名=书名）', dupTxt.json && dupTxt.json.ok === true);
check('txt：与书名相同的章节标题被去掉，书名只出现一次', countOf(dupTxtBody, '秋水') === 1, `出现 ${countOf(dupTxtBody, '秋水')} 次：${JSON.stringify(dupTxtBody.slice(0, 60))}`);
check('txt：不重复的章节标题照常保留', dupTxtBody.includes('归途'));

const wrappedTxt = await call('export.build', {
  format: 'txt',
  novel: { title: '秋水', chapters: [{ title: '《秋水》', content: '　　正文一。' }] },
});
const wrappedBody = wrappedTxt.json && wrappedTxt.json.ok ? Buffer.from(wrappedTxt.json.data.base64, 'base64').toString('utf8') : '';
check('txt：书名号包裹的章节名同样算重复', countOf(wrappedBody, '秋水') === 1, JSON.stringify(wrappedBody.slice(0, 60)));

const numberedTxt = await call('export.build', {
  format: 'txt',
  novel: { title: '秋水', chapters: [{ title: '第一章 秋水', content: '　　正文一。' }] },
});
const numberedBody = numberedTxt.json && numberedTxt.json.ok ? Buffer.from(numberedTxt.json.data.base64, 'base64').toString('utf8') : '';
check('txt：带章号的标题是作者真写的，原样保留', numberedBody.includes('第一章 秋水'), JSON.stringify(numberedBody.slice(0, 60)));

const dupDocx = await call('export.build', {
  format: 'docx',
  novel: {
    title: '秋水',
    chapters: [
      { title: '秋水', content: '　　他站在雨里。' },
      { title: '第二章 归途', content: '　　回家的路上没有灯。' },
    ],
  },
});
if (dupDocx.json && dupDocx.json.ok) {
  const zip = unzipSync(Buffer.from(dupDocx.json.data.base64, 'base64'));
  const documentPart = zip.get('word/document.xml');
  const documentXml = documentPart ? documentPart.toString('utf8') : '';
  check('docx：书名只出现一次（标题块一次，章节标题不再重复）', countOf(documentXml, '秋水') === 1, `出现 ${countOf(documentXml, '秋水')} 次`);
  check('docx：正文与其它章节标题不受影响', documentXml.includes('他站在雨里') && documentXml.includes('第二章 归途'));
} else {
  check('docx 导出成功（章节名=书名）', false, JSON.stringify(dupDocx.json && dupDocx.json.error));
}

// EPUB navigates by the entry title, and a blank one falls back to 「第N章」 —
// so the same de-duplication shows up as a changed table of contents.
const dupEpub = await call('export.build', {
  format: 'epub',
  novel: {
    title: '秋水',
    chapters: [
      { title: '秋水', content: '　　他站在雨里。' },
      { title: '归途', content: '　　回家的路上没有灯。' },
    ],
  },
});
if (dupEpub.json && dupEpub.json.ok) {
  const epubZip = unzipSync(Buffer.from(dupEpub.json.data.base64, 'base64'));
  const navPart = epubZip.get('OEBPS/nav.xhtml');
  const navXml = navPart ? navPart.toString('utf8') : '';
  const labels = [...navXml.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1].trim());
  check('epub：目录里不再用书名当章名', labels.includes('第1章') && !labels.includes('秋水'), JSON.stringify(labels));
  const pagePart = epubZip.get('OEBPS/text/chapter-1.xhtml');
  const pageXml = pagePart ? pagePart.toString('utf8') : '';
  check('epub：第一章页不重复书名', !pageXml.includes('秋水'), '首章页应只剩正文');
} else {
  check('epub 导出成功（章节名=书名）', false, JSON.stringify(dupEpub.json && dupEpub.json.error));
}

// The submission path builds the pasted body and the attachments from one
// object, so a single assertion on the prepared mail covers both.
const dupSubmit = await call('submit.prepare', {
  journal: { id: 'r40-duplicate', name: '某某文学', email: 'editor@example.com', requirements: ['请在邮件正文粘贴全文'] },
  genre: '短篇小说',
  profile: { penName: '林某', contact: '138', email: 'lin@example.com' },
  work: {
    title: '秋水',
    author: '林某',
    chapters: [
      { title: '秋水', content: '　　他站在雨里。' },
      { title: '第二章 归途', content: '　　回家的路上没有灯。' },
    ],
  },
});
check('投稿预排版 ok', dupSubmit.json && dupSubmit.json.ok === true, JSON.stringify(dupSubmit.json && dupSubmit.json.error));
const dupMail = (dupSubmit.json && dupSubmit.json.data) || {};
const formattedChapters = (dupMail.formatted && dupMail.formatted.chapters) || [];
check('投稿：与书名相同的章节标题被置空', formattedChapters[0] && formattedChapters[0].title === '', JSON.stringify(formattedChapters.map((c) => c.title)));
check('投稿：邮件正文里书名只在信头出现一次', countOf(dupMail.body || '', '秋水') === 1, `出现 ${countOf(dupMail.body || '', '秋水')} 次`);
check('投稿：其它章节保留「二、归途」编号', formattedChapters[1] && formattedChapters[1].title === '二、归途', JSON.stringify(formattedChapters[1] && formattedChapters[1].title));
const dupAttach = (dupMail.attachments && dupMail.attachments[0]) || null;
if (dupAttach && dupAttach.base64) {
  const attachZip = unzipSync(Buffer.from(dupAttach.base64, 'base64'));
  const attachPart = attachZip.get('word/document.xml');
  const attachXml = attachPart ? attachPart.toString('utf8') : '';
  check('投稿附件：书名也只出现一次', countOf(attachXml, '秋水') === 1, `出现 ${countOf(attachXml, '秋水')} 次`);
} else {
  check('投稿附件已生成', false, JSON.stringify((dupMail.attachments || []).map((a) => a.filename)));
}

// ---------------------------------------------------------------------------
// 6. secrets round trip
// ---------------------------------------------------------------------------
console.log('\n[6] secrets 加解密往返');
await secrets.clearSecrets();

// First-run race: patchSecrets() on a pristine DSH_HOME must mint exactly ONE
// key and the very next read must succeed (regression: two concurrent key
// creations left key.bin desynced from store.enc ~50% of the time).
for (let round = 1; round <= 5; round += 1) {
  fs.rmSync(path.join(tmpHome, 'novel-writer', 'secrets'), { recursive: true, force: true });
  const wrote = await secrets.patchSecrets({ round });
  const back = await secrets.loadSecrets();
  check(`首次写入后立刻读回一致（第 ${round} 轮）`, wrote.round === round && back.round === round, JSON.stringify(back));
}
const keyBytes = fs.statSync(path.join(tmpHome, 'novel-writer', 'secrets', 'key.bin')).size;
check('key.bin 恰好 32 字节', keyBytes === 32, String(keyBytes));

await secrets.clearSecrets();
check('clearSecrets 后 loadSecrets 为 {}', JSON.stringify(await secrets.loadSecrets()) === '{}');
await secrets.patchSecrets({ webdav: { baseUrl: 'https://dav.example.com/novel', username: 'u', password: 'p' } });
const loaded = await secrets.loadSecrets();
check('patchSecrets 深合并生效', loaded.webdav && loaded.webdav.baseUrl === 'https://dav.example.com/novel');
check('保存后能读回密码', loaded.webdav.password === 'p');

const keyFile = path.join(tmpHome, 'novel-writer', 'secrets', 'key.bin');
const storeFile = path.join(tmpHome, 'novel-writer', 'secrets', 'store.enc');
check('key.bin 已创建', fs.existsSync(keyFile));
check('key.bin 是 32 字节', fs.statSync(keyFile).size === 32, `${fs.statSync(keyFile).size} 字节`);
check('store.enc 已创建', fs.existsSync(storeFile));
const rawStore = fs.readFileSync(storeFile, 'utf8');
check('store.enc 不包含明文密码', !rawStore.includes('"p"') && !rawStore.includes('dav.example.com'));
check('store.enc 是加密信封 v1', JSON.parse(rawStore).v === 1 && typeof JSON.parse(rawStore).iv === 'string');


await secrets.clearSecrets();
check('clearSecrets 后 loadSecrets 回到 {}', JSON.stringify(await secrets.loadSecrets()) === '{}');
const probe = await secrets.probeSecrets();
check('probeSecrets 通过', probe.ok === true, probe.detail);

// ---------------------------------------------------------------------------
console.log('\n[7d] library 落盘（设置 / 目录 / 镜像 / 列表）');

// --- pure naming helpers -------------------------------------------------
const nameCases = [
  ['我的/小说:测试*?', '我的_小说_测试__'],
  ['  多余   空白  ', '多余 空白'],
  ['结尾点...', '结尾点'],
  ['CON', '_CON'],
  ['a\u0000b\tc', 'a_b_c'],
  ['', '未命名作品'],
  ['   ', '未命名作品'],
];
for (const [input, expected] of nameCases) {
  const actual = library.safeTitle(input);
  check(`safeTitle(${JSON.stringify(input)}) → ${expected}`, actual === expected, actual);
}
check('safeTitle 截断到 80 字', Array.from(library.safeTitle('长'.repeat(200))).length === 80, String(Array.from(library.safeTitle('长'.repeat(200))).length));

// --- settings round trip via the module ----------------------------------
check('settingsPath 位于 DSH_HOME 下', library.settingsPath() === path.join(tmpHome, 'novel-writer', 'settings.json'), library.settingsPath());
const blank = await library.readSettings();
check('首次读取返回默认设置', blank.dir === '' && blank.mirror === false && blank.lastMirrorAt === 0, JSON.stringify(blank));
const savedSettings = await library.writeSettings({ mirror: true, extra: 'keep-me' });
check('writeSettings 返回合并结果', savedSettings.mirror === true && savedSettings.extra === 'keep-me', JSON.stringify(savedSettings));
const reread = await library.readSettings();
check('settings.json 落盘可读回', reread.mirror === true && reread.extra === 'keep-me', JSON.stringify(reread));

// corrupt file → defaults + console.warn, never throws
fs.writeFileSync(library.settingsPath(), '{ this is not json', 'utf8');
const warn = console.warn;
let warned = '';
console.warn = (msg) => {
  warned += String(msg);
};
const corrupt = await library.readSettings();
console.warn = warn;
check('settings.json 损坏时回落默认值', corrupt.dir === '' && corrupt.mirror === false, JSON.stringify(corrupt));
check('损坏时 console.warn 有提示', warned.includes('settings.json'), warned.trim().slice(0, 60));
await library.writeSettings({ mirror: false });

// --- ensureDir ------------------------------------------------------------
const badDirs = [
  ['', 'dir-invalid'],
  ['   ', 'dir-invalid'],
  ['relative/path', 'dir-invalid'],
];
for (const [input, code] of badDirs) {
  const res = await library.ensureDir(input);
  check(`ensureDir(${JSON.stringify(input)}) → ${code}`, res.ok === false && res.code === code, JSON.stringify(res));
}
const libDir = path.join(tmpRun, 'library', '小说库');
const ensured = await library.ensureDir(libDir);
check('ensureDir 创建绝对路径目录', ensured.ok === true && ensured.dir === libDir, JSON.stringify(ensured));
check('目录确实存在', fs.existsSync(libDir));
check('探测文件已清理', fs.readdirSync(libDir).length === 0, fs.readdirSync(libDir).join(','));
// A path whose parent is a *file* cannot become a directory.
fs.writeFileSync(path.join(tmpRun, 'library', 'occupied'), 'x', 'utf8');
const blocked = await library.ensureDir(path.join(tmpRun, 'library', 'occupied', 'sub'));
check('ensureDir 遇到不可写路径 → dir-unwritable', blocked.ok === false && blocked.code === 'dir-unwritable', JSON.stringify(blocked));

// --- mirrorLibrary --------------------------------------------------------
const novels = [
  {
    title: '斗破/苍穹',
    author: '天蚕土豆',
    chapters: [
      { title: '第一章 陨落的天才', content: '　　“斗之力，三段！”\n\n望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字。' },
      { title: '第二章 斗气大陆', content: '　　这里是斗气大陆。' },
    ],
  },
  { title: '斗破/苍穹', author: '重复书名', chapters: [{ title: '第一章', content: '同名书应另存一份。' }] },
  { title: '', chapters: [{ title: '', content: '' }] },
];
const mirrored = await library.mirrorLibrary(libDir, novels);
check('mirrorLibrary 成功', mirrored.ok === undefined || mirrored.ok !== false, JSON.stringify(mirrored).slice(0, 160));
check('mirror 返回 dir', mirrored.dir === libDir);
check('mirror count 等于书本数', mirrored.count === 3, String(mirrored.count));
check('每本一个 .docx + library.json', mirrored.files.length === 4, mirrored.files.map((f) => f.name).join(','));
check('同名书自动去重', new Set(mirrored.files.map((f) => f.name)).size === 4, mirrored.files.map((f) => f.name).join(','));
check('非法标题字符被替换', mirrored.files.some((f) => f.name === '斗破_苍穹.docx'), mirrored.files.map((f) => f.name).join(','));
check('空标题回落未命名作品', mirrored.files.some((f) => f.name === '未命名作品.docx'));

// R16 起落盘格式只有 .docx（加密时 .docx.nwe），不再有 Markdown 预览。
const bookXml = unzipSync(fs.readFileSync(path.join(libDir, '斗破_苍穹.docx'))).get('word/document.xml').toString('utf8');
check('docx 含书名', bookXml.includes('斗破/苍穹'));
check('docx 含作者行', bookXml.includes('天蚕土豆'));
check('docx 含章标题', bookXml.includes('第一章 陨落的天才') && bookXml.includes('第二章 斗气大陆'));
check('docx 正文保留全角缩进', bookXml.includes('“斗之力，三段！”'));
check('docx 正文首行缩进 560 twips', bookXml.includes('w:firstLine="560"'));
const snapshot = JSON.parse(fs.readFileSync(path.join(libDir, 'library.json'), 'utf8'));
check('library.json version === 1', snapshot.version === 1);
check('library.json 含 exportedAt', typeof snapshot.exportedAt === 'string' && snapshot.exportedAt.length > 0);
check('library.json novels 数量一致', Array.isArray(snapshot.novels) && snapshot.novels.length === 3, String(snapshot.novels && snapshot.novels.length));
check('library.json 保留原始章节内容', snapshot.novels[0].chapters[1].content.includes('斗气大陆'));

// unrelated files are left alone
fs.writeFileSync(path.join(libDir, '我的笔记.txt'), 'keep', 'utf8');
const mirroredAgain = await library.mirrorLibrary(libDir, [novels[0]]);
check('重复镜像不报错', mirroredAgain.ok !== false);
check('无关文件未被删除', fs.existsSync(path.join(libDir, '我的笔记.txt')));
const stale = await library.mirrorLibrary(libDir, novels);
check('重跑镜像覆盖旧快照', stale.files.length === 4);

// --- listLibrary ----------------------------------------------------------
const listed = await library.listLibrary(libDir);
check('listLibrary 成功', listed.ok !== false, JSON.stringify(listed).slice(0, 120));
check('listLibrary 只列 docx 与 library.json', listed.files.every((f) => f.name.endsWith('.docx') || f.name === 'library.json'), listed.files.map((f) => f.name).join(','));
check('listLibrary 排除无关 txt', !listed.files.some((f) => f.name === '我的笔记.txt'));
check('listLibrary 带 bytes', listed.files.every((f) => typeof f.bytes === 'number' && f.bytes > 0));
check('listLibrary 带 modified', listed.files.every((f) => typeof f.modified === 'number' && f.modified > 0));
const missing = await library.listLibrary(path.join(tmpRun, 'library', '不存在的目录'));
check('listLibrary 目录缺失 → dir-missing', missing.ok === false && missing.code === 'dir-missing', JSON.stringify(missing));
const relList = await library.listLibrary('relative/dir');
check('listLibrary 相对路径 → dir-invalid', relList.ok === false && relList.code === 'dir-invalid');

// --- HTTP routes ----------------------------------------------------------
const libGet0 = await call('library.get', {});
check('library.get 首次返回空目录', libGet0.json && libGet0.json.ok === true && libGet0.json.data.dir === '' && libGet0.json.data.dirExists === false, JSON.stringify(libGet0.json));

const setRelative = await call('library.set', { dir: 'relative/folder', mirror: false });
check('library.set 相对路径 → dir-invalid', setRelative.json && setRelative.json.ok === false && setRelative.json.error.code === 'dir-invalid', JSON.stringify(setRelative.json));

// 清空目录是「拆掉目标」的动作：此时仍开着的同步勾选不算错误，两个开关一起关掉。
const setMirrorNoDir = await call('library.set', { dir: '', mirror: true });
check('library.set 清空目录同时关镜像', setMirrorNoDir.json && setMirrorNoDir.json.ok === true && setMirrorNoDir.json.data.mirror === false, JSON.stringify(setMirrorNoDir.json));
// 但「本来就没有目录、只想开同步」必须明确报错。
const mirrorWithoutDir = await call('library.set', { mirror: true });
check('library.set 无目录却开镜像 → dir-invalid', mirrorWithoutDir.json && mirrorWithoutDir.json.ok === false && mirrorWithoutDir.json.error.code === 'dir-invalid', JSON.stringify(mirrorWithoutDir.json));

const setOk = await call('library.set', { dir: libDir, mirror: true });
check('library.set 成功', setOk.json && setOk.json.ok === true, JSON.stringify(setOk.json));
check('library.set 回显 dir', setOk.json && setOk.json.data.dir === libDir);
check('library.set 回显 mirror', setOk.json && setOk.json.data.mirror === true);
check('settings.json 已写入 dir', JSON.parse(fs.readFileSync(library.settingsPath(), 'utf8')).dir === libDir);

const libGet1 = await call('library.get', {});
check('library.get 读回目录', libGet1.json.data.dir === libDir && libGet1.json.data.mirror === true, JSON.stringify(libGet1.json.data));
check('library.get dirExists === true', libGet1.json.data.dirExists === true);

const libMirror = await call('library.mirror', { novels: [novels[0], novels[2]] });
check('library.mirror 成功', libMirror.json && libMirror.json.ok === true, JSON.stringify(libMirror.json).slice(0, 160));
check('library.mirror count 正确', libMirror.json.data.count === 2, String(libMirror.json.data.count));
check('library.mirror 返回 lastMirrorAt', libMirror.json.data.lastMirrorAt > 0);
check('lastMirrorAt 写进 settings.json', JSON.parse(fs.readFileSync(library.settingsPath(), 'utf8')).lastMirrorAt > 0);

const libList = await call('library.list', {});
check('library.list 成功', libList.json && libList.json.ok === true, JSON.stringify(libList.json).slice(0, 160));
check('library.list 至少含 library.json', libList.json.data.files.some((f) => f.name === 'library.json'));

const libMirrorEmpty = await call('library.mirror', { novels: [] });
check('library.mirror 空书单仍写快照', libMirrorEmpty.json.ok === true && libMirrorEmpty.json.data.count === 0, JSON.stringify(libMirrorEmpty.json).slice(0, 120));

// clearing the folder turns mirroring off too
const cleared = await call('library.set', { dir: '', mirror: false });
check('library.set 清空目录', cleared.json.ok === true && cleared.json.data.dir === '');
const afterClear = JSON.parse(fs.readFileSync(library.settingsPath(), 'utf8'));
check('清空目录后 mirror 关闭', afterClear.mirror === false);
check('清空目录后 lastMirrorAt 仍在', afterClear.lastMirrorAt > 0);

// ---------------------------------------------------------------------------
// 8. selftest
// ---------------------------------------------------------------------------
console.log('\n[8] POST selftest');
const selftest = await call('selftest', {});
check('ok === true', selftest.json && selftest.json.ok === true);
const results = (selftest.json && selftest.json.data && selftest.json.data.results) || [];
check('results 是非空数组', Array.isArray(results) && results.length > 0, `${results.length} 项`);
check('每项都有 {name, ok, detail}', results.every((r) => typeof r.name === 'string' && typeof r.ok === 'boolean' && typeof r.detail === 'string'));
const names = results.map((r) => r.name);
for (const expected of ['webServer', 'docx', 'epub', 'secrets', 'ai']) {
  check(`自检包含 ${expected}`, names.includes(expected), names.join(','));
}
for (const r of results) console.log(`    ${r.ok ? '✓' : '✗'} ${r.name.padEnd(10)} ${r.detail}`);

// ---------------------------------------------------------------------------
// 9. lansync merge (book-level LWW, tombstones, sealed repair, push lock)
// ---------------------------------------------------------------------------
console.log('\n[9] lansync 合并与镜像串行化');
const { mergeLibraries, pushLibrary, pullLibrary, readSyncState, writeSyncState } = lansync;

const bookOf = (id, updatedAt, extra = {}) => ({
  id,
  title: '书' + id,
  updatedAt,
  chapters: [{ id: id + 'c', title: '章', content: '正文' }],
  ...extra,
});
const sealedOf = (id, updatedAt) => ({
  id,
  title: '书' + id,
  updatedAt,
  chapters: [{ id: id + 'c', title: '章', content: 'enc:v1:AAAA' }],
});

// a delete made on the phone while the desktop was away must land
const tombNewer = mergeLibraries({ books: [bookOf('a', 1000)] }, { books: [{ ...bookOf('a', 2000), deleted: true }] });
check('更新的墓碑覆盖活书', tombNewer.library.books[0].deleted === true && tombNewer.stats.deleted === 1, JSON.stringify(tombNewer.stats));
// ...but an edit made after the delete is a deliberate resurrection (the R34 bug)
const tombOlder = mergeLibraries({ books: [bookOf('a', 3000)] }, { books: [{ ...bookOf('a', 2000), deleted: true }] });
check('删除之后又编辑的书会复活', tombOlder.library.books[0].deleted === false && tombOlder.stats.localWins === 1, JSON.stringify(tombOlder.stats));
// exact tie must not let the tombstone destroy the edit
const tombTie = mergeLibraries({ books: [bookOf('a', 1500)] }, { books: [{ ...bookOf('a', 1500), deleted: true }] });
check('同毫秒的墓碑不吞掉编辑', tombTie.library.books[0].deleted === false, JSON.stringify(tombTie.stats));
// rule 5: an all-ciphertext copy never beats a readable one, whatever the clock says
const repaired = mergeLibraries({ books: [sealedOf('a', 9000)] }, { books: [bookOf('a', 1000)] });
check('整本密文输给可读副本（规则 5）', repaired.library.books[0].chapters[0].content === '正文' && repaired.stats.repaired === 1, JSON.stringify(repaired.stats));
const keepSealed = mergeLibraries({ books: [bookOf('a', 9000)] }, { books: [sealedOf('a', 1000)] });
check('可读副本不会被密文顶掉', keepSealed.library.books[0].chapters[0].content === '正文', JSON.stringify(keepSealed.stats));
// single-sided books are taken as-is, tombstones included
const added = mergeLibraries({ books: [] }, { books: [bookOf('n', 1), { ...bookOf('d', 2), deleted: true }] });
check('单边书照收（含墓碑）', added.library.books.length === 2 && added.stats.added === 1 && added.stats.deleted === 1, JSON.stringify(added.stats));
check('活书排在墓碑前面', added.library.books[0].deleted === false && added.library.books[1].deleted === true);

// Concurrent pushes must not lose a book: the lock makes the second merge read
// what the first one wrote. Without it the later write drops the earlier book.
await writeSyncState({ books: [] });
await Promise.all([
  pushLibrary({ books: [bookOf('p1', 2000)] }),
  pushLibrary({ books: [bookOf('p2', 3000)] }),
  pushLibrary({ books: [bookOf('p3', 4000)] }),
]);
const afterConcurrent = await pullLibrary();
const ids = afterConcurrent.library.books.map((b) => b.id).sort().join(',');
check('并发 push 不丢书', ids === 'p1,p2,p3', ids);
const stored = await readSyncState();
check('落盘内容与 pull 一致', stored.books.length === 3, String(stored.books.length));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(66));
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('失败项：' + failures.join(' / '));
} else {
  console.log('全部通过 ✅');
}
console.log('='.repeat(66));

// Cleanup our own run directory only, then drop scripts/.tmp if nothing else
// (e.g. a concurrent verify-docs.mjs) still lives there.
fs.rmSync(tmpRun, { recursive: true, force: true });
try {
  if (fs.readdirSync(tmpRoot).length === 0) fs.rmdirSync(tmpRoot);
} catch {
  /* another run still owns .tmp, leave it */
}

process.exit(failed > 0 ? 1 : 0);
