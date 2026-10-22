#!/usr/bin/env node
// Live acceptance test for @local/novel-writer.
//
// Unlike verify-host.mjs (which drives the lib modules in-process with stubs),
// this script talks to the RUNNING Host over real HTTP. It therefore proves the
// deployed plugin — route registration, document engines, AI proofreading and
// cloud backup — actually works end to end.
//
// Prerequisites:
//   1. the plugin is installed and enabled in the current profile
//   2. `dsh web` / the desktop app is serving. The web port changes on every
//      launch, so unless a baseUrl is given this script probes the known ports.
//
// Usage:
//   node scripts/verify-e2e.mjs [baseUrl]
//   NOVEL_WRITER_BASE=http://127.0.0.1:56359 node scripts/verify-e2e.mjs
//
// Exit code 0 = every check passed.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The Harness web port is allocated per launch (it was 65464, then 56359, ...).
// Probe the candidates instead of hard-coding one stale port.
const CANDIDATE_PORTS = (process.env.NOVEL_WRITER_PORTS || '65464,56359,56360,56361').split(',').map((s) => s.trim()).filter(Boolean);

async function discoverBase() {
  const explicit = process.argv[2] || process.env.NOVEL_WRITER_BASE;
  if (explicit) return explicit.replace(/\/+$/, '');
  for (const port of CANDIDATE_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${base}/novel-writer/api/ping`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return base;
    } catch {
      // port not serving, try the next one
    }
  }
  return `http://127.0.0.1:${CANDIDATE_PORTS[0]}`;
}

const BASE = await discoverBase();
const API = `${BASE}/novel-writer/api/`;
const HERE = dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? '\u2713' : '\u2717';
  console.log(`  ${mark} ${name}${detail ? `  [${detail}]` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

async function call(method, payload) {
  const res = await fetch(API + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json();
  if (!json || json.ok !== true) {
    const error = (json && json.error) || {};
    throw new Error(`${method} -> ${error.code || 'unknown'}: ${error.message || JSON.stringify(json)}`);
  }
  return json.data;
}
async function get(method) {
  const res = await fetch(API + method);
  const json = await res.json();
  if (!json || json.ok !== true) throw new Error(`${method} -> ${JSON.stringify(json)}`);
  return json.data;
}

const NOVEL = {
  title: '验收测试小说',
  author: '测试作者',
  chapters: [
    { title: '第一章 起风', content: '　　第一段正文。\n\n“你好，”他说。\n\n第三段。' },
    { title: '第二章 落雨', content: '　　第二段正文。\n\n又是一段。' },
  ],
};

// ---------------------------------------------------------------------------
// 1. ping / capabilities
// ---------------------------------------------------------------------------
section('[1] 连通性与能力声明');
const ping = await get('ping');
check('GET ping 返回插件名', ping.name === 'novel-writer', JSON.stringify(ping.name));
check('GET ping 返回版本', typeof ping.version === 'string' && ping.version.length > 0, ping.version);
const caps = ping.capabilities || {};
check('capabilities 声明 docx/epub/txt', caps.docx === true && caps.epub === true && caps.txt === true, JSON.stringify(caps));

// ---------------------------------------------------------------------------
// 2. export: docx / epub / pdf / txt
// ---------------------------------------------------------------------------
section('[2] 导出四种格式');
const exported = {};
for (const format of ['docx', 'epub', 'txt', 'pdf']) {
  if (format === 'pdf' && caps.pdf !== true) {
    console.log('  - pdf 跳过（capabilities.pdf=false，本机无 PDF 引擎）');
    continue;
  }
  try {
    const data = await call('export.build', { format, novel: NOVEL, options: { includeToc: true, pageBreak: true } });
    const bytes = Buffer.from(data.base64 || '', 'base64');
    exported[format] = { bytes, filename: data.filename, mime: data.mime };
    // Binary containers (docx/epub are ZIPs, pdf has its own structure) are
    // necessarily multi-KB; a two-chapter plain-text export legitimately lands
    // around 190 bytes, so txt gets a lower floor.
    const floor = format === 'txt' ? 80 : 500;
    check(`export.build ${format} 产出非空文件`, bytes.length > floor, `${bytes.length} 字节 ${data.filename}`);
  } catch (error) {
    check(`export.build ${format}`, false, error.message);
  }
}

const magic = (buf, n = 4) => buf.subarray(0, n).toString('latin1');
if (exported.docx) {
  check('docx 是 ZIP 容器（PK\\x03\\x04）', magic(exported.docx.bytes) === 'PK\u0003\u0004', magic(exported.docx.bytes).replace(/[^\x20-\x7e]/g, '.'));
  check('docx MIME 正确', /wordprocessingml/.test(exported.docx.mime || ''), exported.docx.mime);
}
if (exported.epub) {
  check('epub 是 ZIP 容器（PK\\x03\\x04）', magic(exported.epub.bytes) === 'PK\u0003\u0004', magic(exported.epub.bytes).replace(/[^\x20-\x7e]/g, '.'));
  check('epub MIME 正确', /epub\+zip/.test(exported.epub.mime || ''), exported.epub.mime);
}
if (exported.pdf) {
  check('pdf 有 %PDF 文件头', magic(exported.pdf.bytes, 5) === '%PDF-', magic(exported.pdf.bytes, 8).replace(/[^\x20-\x7e]/g, '.'));
  check('pdf 有 %%EOF 结尾', exported.pdf.bytes.subarray(-64).includes(Buffer.from('%%EOF')));
}
if (exported.txt) {
  const text = exported.txt.bytes.toString('utf8');
  check('txt 含书名', text.includes(NOVEL.title));
  check('txt 含作者', text.includes(NOVEL.author));
  check('txt 含全部章节标题', NOVEL.chapters.every((c) => text.includes(c.title)));
}

// ---------------------------------------------------------------------------
// 3. import: txt auto-split, then docx/epub round-trip
// ---------------------------------------------------------------------------
section('[3] 导入与自动分章');
const importTxt = await call('import.parse', {
  name: '三章样书.txt',
  base64: Buffer.from('第一章 甲\n甲的内容。\n\n第二章 乙\n乙的内容。\n\n第三章 丙\n丙的内容。', 'utf8').toString('base64'),
});
check('txt 自动切成 3 章', (importTxt.chapters || []).length === 3, JSON.stringify((importTxt.chapters || []).map((c) => c.title)));
check('txt 章节标题保留', (importTxt.chapters || []).map((c) => c.title).join('|') === '第一章 甲|第二章 乙|第三章 丙');

for (const format of ['docx', 'epub']) {
  const file = exported[format];
  if (!file) continue;
  try {
    const back = await call('import.parse', { name: `roundtrip.${format}`, base64: file.bytes.toString('base64') });
    check(`${format} 往返后书名保留`, back.title === NOVEL.title, back.title);
    check(`${format} 往返后作者保留`, back.author === NOVEL.author, back.author);
    check(`${format} 往返后仍是 2 章`, (back.chapters || []).length === 2, String((back.chapters || []).length));
    const first = (back.chapters || [])[0] || {};
    check(`${format} 往返后正文内容一致`, typeof first.content === 'string' && first.content.includes('第一段正文'), String(first.content || '').slice(0, 20));
  } catch (error) {
    check(`${format} 往返导入`, false, error.message);
  }
}

// ---------------------------------------------------------------------------
// 4. models
// ---------------------------------------------------------------------------
section('[4] 模型目录');
const models = await call('models', {});
check('models 列出提供方', Array.isArray(models.providers) && models.providers.length > 0, String((models.providers || []).length) + ' 个');
check('models 列出模型', Array.isArray(models.models) && models.models.length > 0, String((models.models || []).length) + ' 个');
check('models 给出当前默认', Boolean(models.current && models.current.provider && models.current.model), JSON.stringify(models.current));

// ---------------------------------------------------------------------------
// 5. AI proofreading against a real model (optional — needs a configured model)
// ---------------------------------------------------------------------------
section('[5] AI 校对（真实模型）');
const DIRTY = '他心理很高兴。\n我们因该去看看,顺便买点水果。';
if (models.current && models.current.provider) {
  try {
    const started = Date.now();
    const proof = await call('proofread', {
      provider: models.current.provider,
      model: models.current.model,
      text: DIRTY,
      mode: 'normal',
    });
    const suggestions = proof.suggestions || [];
    check('proofread 返回建议数组', Array.isArray(suggestions), `${suggestions.length} 条 ${Date.now() - started}ms`);
    check('每条建议的 original 都能在原文中定位', suggestions.every((s) => DIRTY.slice(s.start, s.end) === s.original), suggestions.map((s) => `${s.start}:${s.original}`).join(' '));
    check('建议带 replacement/reason/type', suggestions.every((s) => typeof s.replacement === 'string' && typeof s.reason === 'string' && typeof s.type === 'string'));
    if (suggestions.length > 0) console.log('     示例: ' + JSON.stringify(suggestions[0]));
  } catch (error) {
    check('proofread 调用真实模型', false, error.message);
  }
} else {
  console.log('  - 跳过：没有已配置的默认模型');
}

// ---------------------------------------------------------------------------
// 6. cloud backup over a throwaway local WebDAV server
// ---------------------------------------------------------------------------
section('[6] 云备份（WebDAV 全链路）');
const PORT = 18713;
const USER = 'nw-tester';
const PASS = 'nw-' + Math.random().toString(36).slice(2, 10);
const stored = new Map();
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`, 'utf8').toString('base64');

const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const dav = http.createServer((req, res) => {
  if ((req.headers.authorization || '') !== EXPECTED_AUTH) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="nw"', 'content-type': 'text/plain' });
    return res.end('unauthorized');
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');

  if (req.method === 'PROPFIND') {
    const self = `<d:response><d:href>${xmlEscape(url.pathname)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const kids = [...stored.entries()]
      .map(([n, f]) => {
        const href = `${url.pathname.replace(/\/?$/, '/')}${encodeURIComponent(n)}`;
        return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${f.bytes.length}</d:getcontentlength><d:getlastmodified>${new Date(f.modified).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      })
      .join('');
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    return res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${self}${kids}</d:multistatus>`);
  }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      stored.set(name, { bytes: Buffer.concat(chunks), modified: Date.now() });
      res.writeHead(201, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  if (req.method === 'GET') {
    const hit = stored.get(name);
    if (!hit) {
      res.writeHead(404);
      return res.end('missing');
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': hit.bytes.length });
    return res.end(hit.bytes);
  }
  res.writeHead(405);
  res.end('no');
});

let davUp = false;
try {
  await new Promise((resolve, reject) => {
    dav.once('error', reject);
    dav.listen(PORT, '127.0.0.1', resolve);
  });
  davUp = true;
} catch (error) {
  console.log('  - 跳过：无法在 127.0.0.1:' + PORT + ' 起本地 WebDAV（' + error.message + '）');
}

if (davUp) {
  const baseUrl = `http://127.0.0.1:${PORT}/dav/`;
  try {
    await call('cloud.disconnect', {});
    const beforeState = await call('cloud.status', {});
    check('初始 cloud.status 为未配置', beforeState.kind === 'none' && beforeState.configured === false, JSON.stringify(beforeState));

    await call('cloud.config', { kind: 'webdav', fields: { baseUrl, username: USER, password: PASS } });
    const configured = await call('cloud.status', {});
    check('cloud.config 后 configured=true', configured.configured === true, JSON.stringify(configured));
    check('cloud.status 脱敏显示账号', String(configured.account).includes('127.0.0.1'), configured.account);

    const login = await call('cloud.login', {});
    check('cloud.login 连通性探测通过', login.state === 'ok', JSON.stringify(login));

    const backup = Buffer.from(JSON.stringify({ schema: 1, novels: [NOVEL], at: Date.now() }), 'utf8');
    const name = 'nw-acceptance-backup.json';
    const up = await call('cloud.upload', { name, base64: backup.toString('base64') });
    check('cloud.upload 成功', up.size === backup.length, `${up.size} 字节`);
    check('WebDAV 服务端确实收到同样字节', stored.get(name)?.bytes.length === backup.length);

    const listed = await call('cloud.list', {});
    const item = (listed.items || []).find((it) => it.name === name);
    check('cloud.list 能看到上传的文件', Boolean(item), JSON.stringify((listed.items || []).map((i) => i.name)));

    const down = await call('cloud.download', { id: item ? item.id : up.id });
    const got = Buffer.from(down.base64, 'base64');
    check('cloud.download 字节完全一致', got.equals(backup), `${got.length} vs ${backup.length}`);
    const restored = JSON.parse(got.toString('utf8'));
    check('下载内容可恢复为小说结构', restored.novels?.[0]?.title === NOVEL.title && restored.novels[0].chapters.length === 2);

    const synced = await call('cloud.status', {});
    check('上传后 lastSync 更新', synced.lastSync > 0, String(synced.lastSync));
    check('上传后不误报冲突', synced.conflict === false, String(synced.conflict));

    await call('cloud.disconnect', {});
    const cleared = await call('cloud.status', {});
    check('cloud.disconnect 清空凭据', cleared.kind === 'none' && cleared.configured === false, JSON.stringify(cleared));
  } catch (error) {
    check('云备份全链路', false, error.message);
  } finally {
    dav.close();
  }
}

// ---------------------------------------------------------------------------
// 6b. library (novel save directory): settings round-trip + Markdown mirror
// ---------------------------------------------------------------------------
section('[6b] 小说保存目录');
const libDir = fs.mkdtempSync(join(os.tmpdir(), 'nw-library-'));
try {
  const before = await call('library.get', {});
  check('library.get 返回目录状态', typeof before.dir === 'string', JSON.stringify(before));

  await call('library.set', { dir: libDir, mirror: true });
  const after = await call('library.get', {});
  check('library.set 持久化目录', after.dir === libDir, after.dir);
  check('library.set 持久化 mirror 开关', after.mirror === true, String(after.mirror));
  check('library.get 报告目录存在', after.dirExists === true, String(after.dirExists));

  const mirrored = await call('library.mirror', { novels: [{ title: NOVEL.title, author: NOVEL.author, chapters: NOVEL.chapters }] });
  check('library.mirror 写出 Markdown', (mirrored.files || []).length >= 1, JSON.stringify((mirrored.files || []).map((f) => f.name)));
  check('library.mirror 更新 lastMirrorAt', mirrored.lastMirrorAt > 0, String(mirrored.lastMirrorAt));

  const mdName = (mirrored.files || []).filter((f) => /\.md$/.test(f.name))[0];
  const mdText = mdName ? fs.readFileSync(join(libDir, mdName.name), 'utf8') : '';
  check('镜像 md 含书名标题', mdText.includes('# ' + NOVEL.title), mdText.slice(0, 40));
  check('镜像 md 含章节正文', mdText.includes(NOVEL.chapters[0].title) && mdText.includes('第一段正文'));

  const snapshot = JSON.parse(fs.readFileSync(join(libDir, 'library.json'), 'utf8'));
  check('library.json 是完整快照', Array.isArray(snapshot.novels) && snapshot.novels[0].title === NOVEL.title, 'version=' + snapshot.version);

  const listed = await call('library.list', {});
  check('library.list 列出镜像文件', (listed.files || []).some((f) => f.name === mdName.name), JSON.stringify((listed.files || []).map((f) => f.name)));

  await call('library.set', { dir: '', mirror: false });
  const cleared = await call('library.get', {});
  check('library.set 空目录时关闭镜像', cleared.dir === '' && cleared.mirror === false, JSON.stringify(cleared));
} catch (error) {
  check('小说保存目录', false, error.message);
} finally {
  try {
    fs.rmSync(libDir, { recursive: true, force: true });
  } catch (error) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// 7. selftest summary
// ---------------------------------------------------------------------------
section('[7] Host 自检');
try {
  const self = await call('selftest', {});
  const rows = self.results || [];
  check('selftest 覆盖 6 个子系统', rows.length === 6, rows.map((r) => r.name).join(','));
  const failed = rows.filter((r) => !r.ok);
  check('selftest 全部通过', failed.length === 0, failed.map((r) => r.name + ': ' + r.detail).join('; ') || 'ok');
} catch (error) {
  check('selftest', false, error.message);
}

// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${'='.repeat(60)}`);
console.log(`通过 ${passed} 项，失败 ${total - passed} 项（共 ${total} 项）`);
console.log(`目标: ${API}`);
console.log('='.repeat(60));
process.exitCode = passed === total ? 0 : 1;