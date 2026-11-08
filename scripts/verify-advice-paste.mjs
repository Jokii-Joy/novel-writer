#!/usr/bin/env node
// R85: the paste-import parser, checked without a browser.
//
// The panel renders whatever this returns as ordinary advice cards, so a
// regression here is not "a wrong label" — it is a card that highlights the
// wrong sentence or a writer's paste that silently disappears. The parser is a
// plain IIFE over `window.NW`, so it evaluates in Node with a one-object window.
//
// Usage: node scripts/verify-advice-paste.mjs      (exits 1 on any regression)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'client', 'src', '91-advice-paste.js');
const code = readFileSync(file, 'utf8');

const win = {};
try {
  // eslint-disable-next-line no-new-func
  new Function('window', code)(win);
} catch (error) {
  console.error('verify-advice-paste: could not evaluate client/src/91-advice-paste.js');
  console.error(`  ${error && error.message}`);
  process.exit(1);
}

const parser = win.NW && win.NW.advicePaste;
if (!parser || typeof parser.parse !== 'function' || typeof parser.buildPrompt !== 'function') {
  console.error('verify-advice-paste: window.NW.advicePaste.parse/buildPrompt is missing');
  process.exit(1);
}

const CHAPTER = '雨落在青石板上，他没有回头。她把伞收了，站在门口看了很久。';

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('verify-advice-paste: 从别的 AI 粘贴进来的建议');

// ---------------------------------------------------------------- labelled --
{
  const result = parser.parse(
    [
      '原文：雨落在青石板上，他没有回头。',
      '问题：动作太顺',
      '理由：他应该先犹豫一下',
      '建议：让他停半步再走',
      '类型：节奏',
      '严重度：高',
      '',
      '2. 原文：她把伞收了',
      '问题：收伞太快',
      '建议：先写她听见雨声',
      '类型：细节',
    ].join('\n'),
    CHAPTER,
  );
  ok('中文标签：认出了两条', result.ok && result.items.length === 2, JSON.stringify(result));
  const first = result.items[0] || {};
  ok('中文标签：原文 / 问题 / 理由 / 建议 都在', first.quote === '雨落在青石板上，他没有回头。' && first.issue === '动作太顺' && first.why === '他应该先犹豫一下' && first.advice === '让他停半步再走');
  ok('中文标签：类型与严重度映射到英文 id', first.kind === 'rhythm' && first.severity === 'high');
  ok('中文标签：编号条目被拆开', result.items[1] && result.items[1].quote === '她把伞收了');
  ok('中文标签：quote 的位置按正文算出', first.start === 0 && CHAPTER.slice(first.start, first.end) === first.quote);
}

// -------------------------------------------------------------------- JSON --
{
  const fenced = parser.parse(
    '```json\n[{"quote":"她把伞收了","issue":"动作生硬","advice":"先写她听见雨声","kind":"detail","severity":"medium"}]\n```',
    CHAPTER,
  );
  ok('JSON 数组：围栏被剥掉后仍能解析', fenced.ok && fenced.items.length === 1 && fenced.items[0].advice === '先写她听见雨声');
  const wrapped = parser.parse('{"suggestions":[{"quote":"他没有回头","advice":"补一个动作"}]}', CHAPTER);
  ok('JSON 对象：suggestions 数组被接受', wrapped.ok && wrapped.items[0].quote === '他没有回头');
  ok('JSON：没有 kind 时不猜，留着空', wrapped.ok && wrapped.items[0].kind === '');
}

// ------------------------------------------------------------------ English --
{
  const result = parser.parse('1. Quote: 雨落在青石板上\nIssue: flat\nAdvice: add sound\nKind: rhythm', CHAPTER);
  ok('英文标签：Quote / Issue / Advice 能认', result.ok && result.items.length === 1 && result.items[0].advice === 'add sound');
}

// ------------------------------------------------------------ same line ----
{
  const result = parser.parse('原文：她没有回头 问题：缺反应 建议：写她攥紧伞柄', CHAPTER);
  ok('同一行多个字段：quote 不把后面字段吞进去', result.ok && result.items[0].quote === '她没有回头' && result.items[0].issue === '缺反应');
}

// --------------------------------------------------------- missing / bad ----
{
  const result = parser.parse('原文：这一句不在正文里\n建议：改短一点', CHAPTER);
  ok('原文不在正文：仍导入，但标记未定位', result.ok && result.items.length === 1 && result.items[0].start === -1 && result.unlocated === 1);
  ok('原文不在正文：不编造位置', result.items[0].end === -1);
}
{
  const result = parser.parse('这是一段没有格式的话', CHAPTER);
  ok('认不出格式：ok=false 且有可读的错误', !result.ok && /原文/.test(result.error));
}
{
  const result = parser.parse('   ', CHAPTER);
  ok('空输入：先提示粘贴', !result.ok && /粘贴/.test(result.error));
}
{
  const result = parser.parse('原文：雨落在青石板上\n问题：太顺\n问题：太顺', CHAPTER);
  ok('只有「问题」也能导入，卡片仍带原文', result.ok && result.items.length === 1 && result.items[0].advice === '' && result.items[0].issue === '太顺');
}

// ------------------------------------------------------------------ dedupe --
{
  const result = parser.parse(
    ['原文：她没有回头', '问题：缺反应', '建议：写她攥紧伞柄', '', '原文：她没有回头', '问题：缺反应', '建议：写她攥紧伞柄'].join('\n'),
    CHAPTER,
  );
  ok('同一条贴两次：只留一张卡片', result.ok && result.items.length === 1, `n=${result && result.items && result.items.length}`);
}

// ----------------------------------------------------------------- example --
{
  const result = parser.parse('原文：她把伞收了\n改后：她收了伞，雨声更近了', CHAPTER);
  ok('只有「改后」也算一条建议', result.ok && result.items[0].example === '她收了伞，雨声更近了');
}

// --------------------------------------------------------------- template --
{
  const tpl = String(parser.TEMPLATE || '');
  ok('模板是一段可复制的提示词（含原文 / JSON / 一字不差）', /原文/.test(tpl) && /JSON/.test(tpl) && /一字不差/.test(tpl));
  ok('模板自带示例，照着填即可', /问题/.test(tpl) && /建议/.test(tpl));
  ok('十种类型对卡片可见', Array.isArray(parser.kinds) && parser.kinds.length === 10, String(parser.kinds && parser.kinds.length));
}

// ------------------------------------------------------------- full prompt --
{
  const items = [
    {
      quote: '她没有回头',
      issue: '缺反应',
      why: '读者不知道她怎么想',
      advice: '补一个动作',
      example: '她攥紧了伞柄',
      kind: 'detail',
      severity: 'high',
    },
    { quote: '她把伞收了', issue: '节奏太快' },
  ];
  const prompt = parser.buildPrompt(CHAPTER, items);
  ok('默认复制：正文全文原样带上', prompt.includes(CHAPTER) && prompt.includes('本章全文'));
  ok('默认复制：标题里写出全文字数', prompt.includes('（' + CHAPTER.length + ' 字）'), String(CHAPTER.length));
  ok(
    '默认复制：全部问题的原文和问题都在',
    items.every((item) => prompt.includes('原文：' + item.quote) && prompt.includes('问题：' + item.issue)),
  );
  ok(
    '默认复制：理由 / 建议 / 改后 / 类型 / 严重度按格式带出',
    /理由：读者不知道她怎么想/.test(prompt) &&
      /建议：补一个动作/.test(prompt) &&
      /改后：她攥紧了伞柄/.test(prompt) &&
      /类型：detail/.test(prompt) &&
      /严重度：high/.test(prompt),
  );
  ok('默认复制：条数写在标题里', prompt.includes('2 条，请勿重复'));
  ok('默认复制：后面仍是一份可执行的格式说明', /一字不差/.test(prompt) && /JSON/.test(prompt));
  ok(
    '默认复制：复制出去的问题还能解析回卡片',
    parser.parse(prompt.slice(prompt.indexOf('已有的问题')), CHAPTER).ok,
  );
}
{
  const bare = parser.buildPrompt('', []);
  ok('没有正文和问题时仍是一份完整提示词', bare.includes('（当前章节没有内容）') && bare.includes('（暂无）') && bare.includes('0 条，请勿重复'));
}
{
  const long = '长'.repeat(12000);
  const big = parser.buildPrompt(long, []);
  ok('默认复制不截断长章', big.includes(long) && big.length > long.length, `len=${big.length}`);
}

console.log('');
if (fail) {
  console.error(`结果: ${pass} 通过, ${fail} 失败`);
  process.exit(1);
}
console.log(`结果: ${pass} 通过, 0 失败`);
