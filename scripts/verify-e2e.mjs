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
// 6. cloud backup — removed in R9
// ---------------------------------------------------------------------------
section('[6] 云备份（R9 已移除）');
try {
  await call('cloud.status', {});
  check('cloud.* 已被移除（应返回 unknown-method）', false, 'cloud.status 仍然存在');
} catch (error) {
  check('cloud.* 已随 R9 移除（unknown-method）', /unknown-method/.test(String(error && error.message)), String(error && error.message).slice(0, 120));
}

// ---------------------------------------------------------------------------
// 6b. library (novel save directory): settings round-trip + Markdown mirror
// ---------------------------------------------------------------------------
section('[6b] 小说保存目录');
// R81: this section used to overwrite the live host's save directory and clear
// it afterwards, and it still expected the pre-R10 Markdown mirror. Now it is
// opt-in, restores the previous settings in `finally`, and checks the format the
// plugin actually writes (.docx + library.json).
if (process.env.NOVEL_WRITER_E2E_WRITE !== '1') {
  console.log('  - 跳过：这一段会改动宿主里的保存目录设置。需要时用 NOVEL_WRITER_E2E_WRITE=1 重跑。');
} else {
  const libDir = fs.mkdtempSync(join(os.tmpdir(), 'nw-library-'));
  let before = null;
  try {
    before = await call('library.get', {});
    check('library.get 返回目录状态', typeof before.dir === 'string', JSON.stringify(before));

    await call('library.set', { dir: libDir, mirror: true, encrypt: false });
    const after = await call('library.get', {});
    check('library.set 持久化目录', after.dir === libDir, after.dir);
    check('library.set 持久化 mirror 开关', after.mirror === true, String(after.mirror));
    check('library.get 报告目录存在', after.dirExists === true, String(after.dirExists));

    const mirrored = await call('library.mirror', {
      novels: [{ title: NOVEL.title, author: NOVEL.author, chapters: NOVEL.chapters }],
      chapters: [],
      notes: [],
      marks: [],
      lore: [],
      revisions: [],
    });
    check('library.mirror 写出 .docx', (mirrored.files || []).some((f) => /\.docx$/.test(f.name)), JSON.stringify((mirrored.files || []).map((f) => f.name)));
    check('library.mirror 更新 lastMirrorAt', mirrored.lastMirrorAt > 0, String(mirrored.lastMirrorAt));
    check('library.mirror 回显快照附加项', mirrored.marks === 0 && mirrored.lore === 0 && mirrored.revisions === 0, JSON.stringify(mirrored).slice(0, 120));

    const docxName = (mirrored.files || []).filter((f) => /\.docx$/.test(f.name))[0];
    const docxHead = docxName ? fs.readFileSync(join(libDir, docxName.name)).subarray(0, 2).toString('latin1') : '';
    check('镜像 .docx 是合法 ZIP（PK 头）', docxHead === 'PK', docxHead);

    const snapshot = JSON.parse(fs.readFileSync(join(libDir, 'library.json'), 'utf8'));
    check('library.json 是完整快照', Array.isArray(snapshot.novels) && snapshot.novels[0].title === NOVEL.title, 'version=' + snapshot.version);

    const listed = await call('library.list', {});
    check('library.list 列出镜像文件', (listed.files || []).some((f) => f.name === docxName.name), JSON.stringify((listed.files || []).map((f) => f.name)));
  } catch (error) {
    check('小说保存目录', false, error.message);
  } finally {
    // Restore whatever the user had before this run.
    if (before) {
      try {
        await call('library.set', { dir: before.dir || '', mirror: before.mirror === true, encrypt: before.encrypt === true });
      } catch (error) {
        console.log('  ! 恢复保存目录设置失败：' + error.message);
      }
    }
    try {
      fs.rmSync(libDir, { recursive: true, force: true });
    } catch (error) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// 7. selftest summary
// ---------------------------------------------------------------------------
section('[7] Host 自检');
try {
  const self = await call('selftest', {});
  const rows = self.results || [];
  check('selftest 至少覆盖 6 个子系统', rows.length >= 6, rows.map((r) => r.name).join(','));
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