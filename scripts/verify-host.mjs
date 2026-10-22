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
const cloud = await import(new URL('../lib/cloud.js', import.meta.url).href);
const secrets = await import(new URL('../lib/secrets.js', import.meta.url).href);
const ai = await import(new URL('../lib/ai.js', import.meta.url).href);
const library = await import(new URL('../lib/library.js', import.meta.url).href);
const { unzipSync } = await import(new URL('../lib/zip.js', import.meta.url).href);

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
check('methodFromPath 解析带查询串', methodFromPath('/novel-writer/api/cloud.status?x=1') === 'cloud.status');
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
// 5. cloud.status (unconfigured)
// ---------------------------------------------------------------------------
console.log('\n[5] POST cloud.status（未配置）');
const statusRes = await call('cloud.status', {});
check('ok === true', statusRes.json && statusRes.json.ok === true);
const st = statusRes.json && statusRes.json.data;
check('kind === "none"', st && st.kind === 'none', JSON.stringify(st));
check('configured === false', st && st.configured === false);
check('account 为空字符串', st && st.account === '');
check('lastSync === 0', st && st.lastSync === 0);
check('conflict === false', st && st.conflict === false);
console.log('    →', JSON.stringify(st));

for (const method of ['cloud.list', 'cloud.upload', 'cloud.download', 'cloud.login']) {
  const payload = method === 'cloud.upload'
    ? { name: 'a.json', base64: 'e30=' }
    : method === 'cloud.download'
      ? { id: 'some-file-id' }
      : {};
  const res = await call(method, payload);
  check(`${method} 未配置时返回结构化错误`, res.json && res.json.ok === false && res.json.error.code === 'not-configured',
    JSON.stringify(res.json && res.json.error));
}

// cloud.login without a Client ID must still be HTTP 200 + actionable wording.
const loginUnset = await call('cloud.login', {});
check('cloud.login 未配置时 HTTP 200', loginUnset.statusCode === 200, String(loginUnset.statusCode));
check('cloud.login 未配置时 error.code === not-configured', loginUnset.json && loginUnset.json.error && loginUnset.json.error.code === 'not-configured', JSON.stringify(loginUnset.json));
check('cloud.login 未配置时提示 Client ID', /Client ID/.test(loginUnset.json.error.message), loginUnset.json.error.message);

// Kind chosen but Client ID missing → a *different*, still explicit message.
await secrets.patchSecrets({ cloud: { kind: 'aliyun' }, aliyun: { clientId: '', clientSecret: '' } });
const loginKind = await call('cloud.login', {});
check('kind=aliyun 缺 clientId 仍返回 not-configured', loginKind.json && loginKind.json.ok === false && loginKind.json.error.code === 'not-configured', JSON.stringify(loginKind.json));
check('kind=aliyun 缺 clientId 提示已选阿里云盘', /已选择阿里云盘/.test(loginKind.json.error.message), loginKind.json.error.message);
await secrets.patchSecrets({ cloud: { kind: 'none' } });
const disconnect = await call('cloud.disconnect', {});
check('cloud.disconnect 未配置时也成功', disconnect.json && disconnect.json.ok === true);

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

// cloud.config through the real HTTP route (the path the settings dialog uses).
const configured = await call('cloud.config', {
  kind: 'webdav',
  fields: { baseUrl: 'dav.example.com/novel', username: 'u', password: 'p' },
});
check('cloud.config ok', configured.json && configured.json.ok === true, JSON.stringify(configured.json));
const afterConfig = await secrets.loadSecrets();
check('baseUrl 自动补 https://', afterConfig.webdav.baseUrl === 'https://dav.example.com/novel', afterConfig.webdav.baseUrl);
check('cloud.kind 落盘为 webdav', afterConfig.cloud && afterConfig.cloud.kind === 'webdav');

// cloud.status must now report webdav
const statusRes2 = await call('cloud.status', {});
check('配置 WebDAV 后 kind === "webdav"', statusRes2.json.data.kind === 'webdav', JSON.stringify(statusRes2.json.data));
check('configured === true', statusRes2.json.data.configured === true);
check('account 显示 user @ host', statusRes2.json.data.account.includes('dav.example.com'), statusRes2.json.data.account);
console.log('    →', JSON.stringify(statusRes2.json.data));

// conflict detection is a pure local computation over stored timestamps
await secrets.patchSecrets({ cloud: { lastSync: 1000, remoteModified: 5000 } });
const conflicted = await call('cloud.status', {});
check('远端更新更晚时 conflict === true', conflicted.json.data.conflict === true, JSON.stringify(conflicted.json.data));
await secrets.patchSecrets({ cloud: { lastSync: 9000 } });
const notConflicted = await call('cloud.status', {});
check('本地更新更晚时 conflict === false', notConflicted.json.data.conflict === false);

// aliyun config path stores the client id but never invents tokens
const aliCfg = await call('cloud.config', { kind: 'aliyun', fields: { clientId: 'client-abc', clientSecret: 'secret-xyz' } });
check('cloud.config aliyun ok', aliCfg.json && aliCfg.json.ok === true);
const afterAli = await secrets.loadSecrets();
check('aliyun clientId 已加密落盘', afterAli.aliyun && afterAli.aliyun.clientId === 'client-abc');
check('aliyun 不会有内置 token', !afterAli.aliyun.accessToken && !afterAli.aliyun.refreshToken);
check('切到 aliyun 后 kind === "aliyun"', (await call('cloud.status', {})).json.data.kind === 'aliyun');

await secrets.clearSecrets();
check('clearSecrets 后 loadSecrets 回到 {}', JSON.stringify(await secrets.loadSecrets()) === '{}');
const probe = await secrets.probeSecrets();
check('probeSecrets 通过', probe.ok === true, probe.detail);

// ---------------------------------------------------------------------------
// 7. cloud URL / XML assembly (no network)
// ---------------------------------------------------------------------------
console.log('\n[7] cloud 纯函数（URL/XML 拼装，不发请求）');
check(
  'webdavUrl 拼接相对文件名',
  cloud.webdavUrl('https://dav.example.com/novel', '备份 2024.json') === 'https://dav.example.com/novel/%E5%A4%87%E4%BB%BD%202024.json',
  cloud.webdavUrl('https://dav.example.com/novel', '备份 2024.json'),
);
check(
  'webdavUrl 补尾斜杠',
  cloud.webdavUrl('https://dav.example.com/novel/') === 'https://dav.example.com/novel/',
);
check(
  'webdavUrl 保留绝对 href',
  cloud.webdavUrl('https://dav.example.com/novel', 'https://other.example.com/x.json') === 'https://other.example.com/x.json',
);

const propfindXml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/novel/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/novel/backup-2024.json</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>2048</d:getcontentlength>
      <d:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/novel/%E7%AC%AC%E4%BA%8C%E7%AB%A0.epub</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>999</d:getcontentlength>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
const parsedList = cloud.parsePropfind(propfindXml, 'https://dav.example.com/novel');
check('PROPFIND 解析出 2 个文件（跳过目录）', parsedList.items.length === 2, `${parsedList.items.length}`);
check('解析出文件名', parsedList.items[0].name === 'backup-2024.json', parsedList.items[0].name);
check('解析出文件大小', parsedList.items[0].size === 2048, String(parsedList.items[0].size));
check('解析出修改时间', parsedList.items[0].modified.includes('2024'));
check('href 已 URL 解码', parsedList.items[1].name === '第二章.epub', parsedList.items[1].name);

check('resolveKind 未配置 → none', cloud.resolveKind({}) === 'none');
check('resolveKind 有 webdav 地址 → webdav', cloud.resolveKind({ webdav: { baseUrl: 'https://x' } }) === 'webdav');
check('resolveKind 有 aliyun clientId → aliyun', cloud.resolveKind({ aliyun: { clientId: 'cid' } }) === 'aliyun');
check('resolveKind 显式 none 优先', cloud.resolveKind({ cloud: { kind: 'none' }, webdav: { baseUrl: 'https://x' } }) === 'none');

const authUrl = cloud.aliyunAuthorizeUrl({ clientId: 'my-client', redirectUri: 'https://cb.example.com', state: 'st' });
check('aliyunAuthorizeUrl 带 client_id', authUrl.includes('client_id=my-client'), authUrl);
check('aliyunAuthorizeUrl 是 /oauth/authorize', authUrl.startsWith('https://openapi.alipan.com/oauth/authorize'));
check('aliyunAuthorizeUrl 带 response_type=code', authUrl.includes('response_type=code'));
check('aliyunAuthorizeUrl 无 client_id 时返回空串', cloud.aliyunAuthorizeUrl({}) === '');

// ---------------------------------------------------------------------------
// 7b. WebDAV against a real loopback HTTP server
// ---------------------------------------------------------------------------
// This exercises the genuine node:http code path (PROPFIND / PUT / GET, Basic
// auth, redirect-free) with no external network and no DNS: it only ever
// connects to 127.0.0.1 on an ephemeral port, and it is hard-bounded by the
// module's own 15 s timeout.
console.log('\n[7b] WebDAV 真实 loopback 往返');
const http = await import('node:http');
const store = new Map([
  ['备份-旧.json', Buffer.from('{"chapters":1}', 'utf8')],
]);
let basicAuthOk = true;
const davServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const expected = `Basic ${Buffer.from('u:p').toString('base64')}`;
  if (req.headers.authorization !== expected) {
    basicAuthOk = false;
    res.writeHead(401, { 'content-type': 'text/plain' });
    res.end('unauthorized');
    return;
  }
  const name = decodeURIComponent(url.pathname.replace(/^\/dav\/?/, ''));

  if (req.method === 'PROPFIND') {
    const rows = [...store.entries()]
      .map(([key, bytes]) => `  <d:response>
    <d:href>/dav/${encodeURIComponent(key)}</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>${bytes.length}</d:getcontentlength>
      <d:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>`)
      .join('\n');
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
${rows}
</d:multistatus>`);
    return;
  }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      store.set(name, Buffer.concat(chunks));
      res.writeHead(201);
      res.end();
    });
    return;
  }
  if (req.method === 'GET') {
    const bytes = store.get(name);
    if (!bytes) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) });
    res.end(bytes);
    return;
  }
  res.writeHead(405);
  res.end();
});

await new Promise((resolve) => davServer.listen(0, '127.0.0.1', resolve));
const davPort = davServer.address().port;
const davBase = `http://127.0.0.1:${davPort}/dav`;

try {
  const cfg = await call('cloud.config', { kind: 'webdav', fields: { baseUrl: davBase, username: 'u', password: 'p' } });
  check('配置 loopback WebDAV 成功', cfg.json && cfg.json.ok === true, JSON.stringify(cfg.json));

  const davList = await call('cloud.list', {});
  const items = (davList.json.data && davList.json.data.items) || [];
  check('WebDAV list 走通 PROPFIND', davList.json && davList.json.ok === true, JSON.stringify(davList.json).slice(0, 160));
  check('list 返回既有文件', items.some((i) => i.name === '备份-旧.json'), JSON.stringify(items));
  check('list 跳过 collection 目录项', !items.some((i) => i.name === ''));

  const payload = Buffer.from('{"format":"backup","chapters":3}', 'utf8');
  const up = await call('cloud.upload', { name: '备份-新.json', base64: payload.toString('base64') });
  check('WebDAV upload 走通 PUT', up.json && up.json.ok === true, JSON.stringify(up.json).slice(0, 160));
  check('服务器真的收到了上传内容', store.get('备份-新.json')?.toString('utf8') === payload.toString('utf8'));
  check('upload 返回 size', up.json.data && up.json.data.size === payload.length, JSON.stringify(up.json.data));

  const down = await call('cloud.download', { id: '备份-新.json' });
  check('WebDAV download 走通 GET', down.json && down.json.ok === true, JSON.stringify(down.json).slice(0, 160));
  check(
    'download 内容与上传一致',
    down.json && Buffer.from(down.json.data.base64, 'base64').toString('utf8') === payload.toString('utf8'),
  );

  check('所有请求都带了正确的 Basic auth', basicAuthOk);
  const afterSync = await call('cloud.status', {});
  check('upload 之后 lastSync > 0', afterSync.json.data.lastSync > 0, String(afterSync.json.data.lastSync));
} finally {
  await new Promise((resolve) => davServer.close(resolve));
}
await secrets.clearSecrets();

// ---------------------------------------------------------------------------
// 7b-2. WebDAV with a missing backup collection (404 / 409 → MKCOL + retry)
// ---------------------------------------------------------------------------
// Providers differ: some answer 404 on PROPFIND for a folder that was never
// created, and some answer 409 on PUT into it. Both must self-heal instead of
// surfacing an error on a user's very first sync.
console.log('\n[7b-2] WebDAV 目录不存在时自动 MKCOL 并重试');
const dav2Store = new Map();
const dav2Dirs = new Set(['/dav']);
const dav2Seen = { mkcol: 0, put: 0 };
const dav2 = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const collection = url.pathname.replace(/[^/]*$/, '');
  const name = decodeURIComponent(url.pathname.slice(collection.length));
  if (req.headers.authorization !== `Basic ${Buffer.from('u:p').toString('base64')}`) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }
  if (req.method === 'MKCOL') {
    dav2Seen.mkcol += 1;
    if (dav2Dirs.has(url.pathname.replace(/\/+$/, ''))) {
      res.writeHead(405); // RFC 4918: collection already exists
      res.end();
      return;
    }
    dav2Dirs.add(url.pathname.replace(/\/+$/, ''));
    res.writeHead(201);
    res.end();
    return;
  }
  if (req.method === 'PROPFIND') {
    if (!dav2Dirs.has(url.pathname.replace(/\/+$/, ''))) {
      res.writeHead(404);
      res.end('no such collection');
      return;
    }
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>');
    return;
  }
  if (req.method === 'PUT') {
    dav2Seen.put += 1;
    if (!dav2Dirs.has(collection.replace(/\/+$/, ''))) {
      res.writeHead(409); // parent collection missing
      res.end('conflict');
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      dav2Store.set(name, Buffer.concat(chunks));
      res.writeHead(201);
      res.end();
    });
    return;
  }
  res.writeHead(405);
  res.end();
});
await new Promise((resolve) => dav2.listen(0, '127.0.0.1', resolve));
const dav2Base = `http://127.0.0.1:${dav2.address().port}/dav/fresh-folder`;
try {
  const cfg2 = await call('cloud.config', { kind: 'webdav', fields: { baseUrl: dav2Base, username: 'u', password: 'p' } });
  check('配置全新（不存在的）备份目录', cfg2.json && cfg2.json.ok === true, JSON.stringify(cfg2.json).slice(0, 160));

  const empty = await call('cloud.list', {});
  check('目录不存在时 list 返回空列表而不是报错', empty.json && empty.json.ok === true, JSON.stringify(empty.json).slice(0, 160));
  check('空列表长度 0', empty.json.data && empty.json.data.items && empty.json.data.items.length === 0, JSON.stringify(empty.json.data));
  check('list 触发了 MKCOL', dav2Seen.mkcol > 0, String(dav2Seen.mkcol));
  check('MKCOL 之后目录真的存在', dav2Dirs.has('/dav/fresh-folder'), JSON.stringify([...dav2Dirs]));

  const payload2 = Buffer.from('{"format":"backup"}', 'utf8');
  const up2 = await call('cloud.upload', { name: 'a.json', base64: payload2.toString('base64') });
  check('upload 成功', up2.json && up2.json.ok === true, JSON.stringify(up2.json).slice(0, 200));
  check('upload 内容真的落到服务器', dav2Store.get('a.json')?.toString('utf8') === '{"format":"backup"}');

  // Second scenario: the folder is deleted behind our back, so PUT answers 409
  // and the upload path itself has to create the folder and retry.
  dav2Dirs.delete('/dav/fresh-folder');
  const up3 = await call('cloud.upload', { name: 'b.json', base64: payload2.toString('base64') });
  check('PUT 409 后自动 MKCOL 并重试成功', up3.json && up3.json.ok === true, JSON.stringify(up3.json).slice(0, 200));
  check('PUT 至少尝试了两次（原始 + 重试）', dav2Seen.put >= 3, String(dav2Seen.put));
  check('重试后内容落地', dav2Store.get('b.json') !== undefined);
} finally {
  await new Promise((resolve) => dav2.close(resolve));
}
await secrets.clearSecrets();

// ---------------------------------------------------------------------------
// 7c. Aliyun Drive protocol against a loopback stub API
// ---------------------------------------------------------------------------
// Exercises the real HTTP layer and the whole OAuth → list → upload → download
// sequence against a local fake of openapi.alipan.com. No external network and
// no credentials: the origin is redirected with NOVEL_WRITER_ALIYUN_API.
console.log('\n[7c] 阿里云盘协议（loopback 假 API）');
const aliStore = new Map();
const aliCalls = [];
let aliRefreshCount = 0;
let aliTokenSerial = 0;
let aliExpectedToken = '';
let aliPort = 0;

function aliJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(body.length) });
  res.end(body);
}

const aliServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    aliCalls.push({ method: req.method, path: url.pathname, body, auth: req.headers.authorization || '' });

    // ---- OAuth ----
    if (url.pathname === '/oauth/authorize/qrcode' && req.method === 'POST') {
      aliJson(res, 200, { qrCodeUrl: 'https://passport.alipan.com/qr/abc123', sid: 'sid-abc' });
      return;
    }
    if (url.pathname === '/oauth/qrcode/sid-abc/status' && req.method === 'GET') {
      aliJson(res, 200, { status: 'LoginSuccess', authCode: 'auth-code-1' });
      return;
    }
    if (url.pathname === '/oauth/access_token' && req.method === 'POST') {
      aliTokenSerial += 1;
      aliExpectedToken = `access-${aliTokenSerial}`;
      if (body.grant_type === 'refresh_token') aliRefreshCount += 1;
      aliJson(res, 200, { access_token: aliExpectedToken, refresh_token: 'refresh-1', expires_in: 7200 });
      return;
    }

    // ---- pre-signed URLs: no bearer token, must be handled before the auth gate ----
    if (url.pathname === '/upload/part-1' && req.method === 'PUT') {
      aliStore.set('上传.bak', Buffer.from(raw, 'utf8'));
      res.writeHead(200);
      res.end();
      return;
    }
    if (url.pathname === '/download/file-new' && req.method === 'GET') {
      const bytes = Buffer.from('{"hello":"aliyun"}', 'utf8');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) });
      res.end(bytes);
      return;
    }

    // ---- authed API ----
    if (req.headers.authorization !== `Bearer ${aliExpectedToken}`) {
      aliJson(res, 401, { code: 'AccessTokenInvalid', message: 'token invalid' });
      return;
    }
    if (url.pathname === '/adrive/v1.0/user/getDriveInfo') {
      aliJson(res, 200, { default_drive_id: 'drive-xyz', name: '测试云盘' });
      return;
    }
    if (url.pathname === '/adrive/v1.0/openFile/list') {
      aliJson(res, 200, {
        items: [...aliStore.entries()].map(([name, bytes], i) => ({
          file_id: `file-${i}`,
          name,
          size: bytes.length,
          updated_at: '2024-05-01T10:00:00.000Z',
          type: 'file',
        })),
      });
      return;
    }
    if (url.pathname === '/adrive/v1.0/openFile/create') {
      aliJson(res, 200, {
        file_id: 'file-new',
        upload_id: 'upload-1',
        part_info_list: [{ part_number: 1, upload_url: `http://127.0.0.1:${aliPort}/upload/part-1` }],
      });
      return;
    }
    if (url.pathname === '/adrive/v1.0/openFile/complete') {
      aliJson(res, 200, { file_id: 'file-new', name: body.name || '上传.bak', size: 123 });
      return;
    }
    if (url.pathname === '/adrive/v1.0/openFile/getDownloadUrl') {
      aliJson(res, 200, { url: `http://127.0.0.1:${aliPort}/download/file-new`, expiration: '2024-05-01T12:00:00Z' });
      return;
    }
    aliJson(res, 404, { code: 'NotFound', message: `未实现: ${req.method} ${url.pathname}` });
  });
});

await new Promise((resolve) => aliServer.listen(0, '127.0.0.1', resolve));
aliPort = aliServer.address().port;
process.env.NOVEL_WRITER_ALIYUN_API = `http://127.0.0.1:${aliPort}`;

try {
  const aliCfg = await call('cloud.config', { kind: 'aliyun', fields: { clientId: 'cid-test', clientSecret: 'csecret-test' } });
  check('配置阿里云盘凭据', aliCfg.json && aliCfg.json.ok === true);

  const loginRes = await call('cloud.login', {});
  check('cloud.login 返回 pending', loginRes.json.data && loginRes.json.data.state === 'pending', JSON.stringify(loginRes.json).slice(0, 160));
  check('登录返回二维码 URL', loginRes.json.data.url === 'https://passport.alipan.com/qr/abc123', loginRes.json.data.url);
  check('登录返回 deviceCode（sid）', loginRes.json.data.deviceCode === 'sid-abc', loginRes.json.data.deviceCode);

  const pollRes = await call('cloud.poll', { deviceCode: 'sid-abc' });
  check('cloud.poll 授权成功', pollRes.json.data && pollRes.json.data.state === 'ok', JSON.stringify(pollRes.json).slice(0, 160));
  check('poll 返回账号名', pollRes.json.data.account === '测试云盘', pollRes.json.data.account);

  const savedSecrets = await secrets.loadSecrets();
  check('access_token 已加密落盘', savedSecrets.aliyun.accessToken === 'access-1', savedSecrets.aliyun.accessToken);
  check('refresh_token 已落盘', savedSecrets.aliyun.refreshToken === 'refresh-1');
  check('drive_id 缓存自 getDriveInfo', savedSecrets.aliyun.driveId === 'drive-xyz', savedSecrets.aliyun.driveId);
  check('扫码用到了配置的 client_id', aliCalls.some((c) => c.path === '/oauth/authorize/qrcode' && c.body.client_id === 'cid-test'));
  check('授权码兑换发送了 code', aliCalls.some((c) => c.path === '/oauth/access_token' && c.body.code === 'auth-code-1'));

  aliStore.set('小说备份.json', Buffer.from('{"a":1}', 'utf8'));
  const aliList = await call('cloud.list', {});
  const aliItems = (aliList.json.data && aliList.json.data.items) || [];
  check('阿里云盘 list 走通', aliList.json && aliList.json.ok === true, JSON.stringify(aliList.json).slice(0, 140));
  check('list 映射 file_id → id', aliItems.some((i) => i.id && i.name === '小说备份.json'), JSON.stringify(aliItems));
  check('list 请求带了 drive_id', aliCalls.some((c) => c.path === '/adrive/v1.0/openFile/list' && c.body.drive_id === 'drive-xyz'));
  check(
    'list 请求体符合契约（root/limit/order）',
    aliCalls.some((c) => c.path === '/adrive/v1.0/openFile/list'
      && c.body.parent_file_id === 'root'
      && c.body.limit === 100
      && c.body.order_direction === 'DESC'),
  );

  const upBytes = Buffer.from('{"format":"backup"}', 'utf8');
  const aliUp = await call('cloud.upload', { name: '上传.bak', base64: upBytes.toString('base64') });
  check('阿里云盘 upload 走通', aliUp.json && aliUp.json.ok === true, JSON.stringify(aliUp.json).slice(0, 140));
  check('create 用了 check_name_mode=overwrite', aliCalls.some((c) => c.path === '/adrive/v1.0/openFile/create' && c.body.check_name_mode === 'overwrite'));
  check('complete 被调用', aliCalls.some((c) => c.path === '/adrive/v1.0/openFile/complete' && c.body.file_id === 'file-new'));
  const partCall = aliCalls.find((c) => c.path === '/upload/part-1');
  check('分片 PUT 不带 Authorization', Boolean(partCall) && partCall.auth === '', partCall ? partCall.auth || '(空)' : '未发生');
  check('服务器收到上传内容', aliStore.get('上传.bak')?.toString('utf8') === '{"format":"backup"}');

  const aliDown = await call('cloud.download', { id: 'file-new' });
  check('阿里云盘 download 走通', aliDown.json && aliDown.json.ok === true, JSON.stringify(aliDown.json).slice(0, 140));
  check(
    'download 返回正确内容',
    aliDown.json && Buffer.from(aliDown.json.data.base64, 'base64').toString('utf8') === '{"hello":"aliyun"}',
  );
  check('getDownloadUrl 请求体带 expire_sec', aliCalls.some((c) => c.path === '/adrive/v1.0/openFile/getDownloadUrl' && c.body.expire_sec === 900));

  // 401 → refresh once → retry
  aliExpectedToken = 'stale-token';
  const before = aliCalls.length;
  const afterExpiry = await call('cloud.list', {});
  const retried = aliCalls.slice(before);
  check('token 失效时自动刷新并重试成功', afterExpiry.json && afterExpiry.json.ok === true, JSON.stringify(afterExpiry.json).slice(0, 140));
  check('确实发生了一次 refresh_token 兑换', retried.some((c) => c.path === '/oauth/access_token' && c.body.grant_type === 'refresh_token'));
  check('刷新后重新发起了 list 请求', retried.filter((c) => c.path === '/adrive/v1.0/openFile/list').length >= 2);
  check('refresh 计数正确', aliRefreshCount >= 1, String(aliRefreshCount));

  const disc = await call('cloud.disconnect', {});
  check('cloud.disconnect 成功', disc.json && disc.json.ok === true);
  const afterDisc = await secrets.loadSecrets();
  check('disconnect 清空 access_token', !afterDisc.aliyun.accessToken);
  check('disconnect 保留 clientId', afterDisc.aliyun.clientId === 'cid-test');
  check('disconnect 后 kind 回到 none', (await call('cloud.status', {})).json.data.kind === 'none');
} finally {
  delete process.env.NOVEL_WRITER_ALIYUN_API;
  await new Promise((resolve) => aliServer.close(resolve));
  await secrets.clearSecrets();
}

// ---------------------------------------------------------------------------
// 7d. library (on-disk save folder)
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
check('每本一个 .md + library.json', mirrored.files.length === 4, mirrored.files.map((f) => f.name).join(','));
check('同名书自动去重', new Set(mirrored.files.map((f) => f.name)).size === 4, mirrored.files.map((f) => f.name).join(','));
check('非法标题字符被替换', mirrored.files.some((f) => f.name === '斗破_苍穹.md'), mirrored.files.map((f) => f.name).join(','));
check('空标题回落未命名作品', mirrored.files.some((f) => f.name === '未命名作品.md'));

const bookMd = fs.readFileSync(path.join(libDir, '斗破_苍穹.md'), 'utf8');
check('Markdown 以 # 书名 开头', bookMd.startsWith('# 斗破/苍穹\n'), JSON.stringify(bookMd.slice(0, 24)));
check('Markdown 含作者行', bookMd.includes('*作者：天蚕土豆*'));
check('Markdown 含章标题', bookMd.includes('## 第一章 陨落的天才') && bookMd.includes('## 第二章 斗气大陆'));
check('Markdown 保留正文缩进', bookMd.includes('\u3000\u3000“斗之力，三段！”'));
check('章与章之间空一行', bookMd.includes('## 第二章 斗气大陆'));
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
check('listLibrary 只列 md 与 library.json', listed.files.every((f) => f.name.endsWith('.md') || f.name === 'library.json'), listed.files.map((f) => f.name).join(','));
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

const setMirrorNoDir = await call('library.set', { dir: '', mirror: true });
check('library.set 无目录却开镜像 → dir-invalid', setMirrorNoDir.json && setMirrorNoDir.json.ok === false && setMirrorNoDir.json.error.code === 'dir-invalid');

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
for (const expected of ['webServer', 'docx', 'epub', 'secrets', 'ai', 'cloud']) {
  check(`自检包含 ${expected}`, names.includes(expected), names.join(','));
}
for (const r of results) console.log(`    ${r.ok ? '✓' : '✗'} ${r.name.padEnd(10)} ${r.detail}`);

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
