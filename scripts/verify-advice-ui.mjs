// 选中改写 / 接受拒绝 / 已接收 的渲染级检查（R73）。
//
// 为什么要有这个脚本：这些界面（R78 起在 92-advice.js），而"能不能渲染"和
// "能不能点"是两件事——`node --check` 只能证明语法，`verify-client-load` 只能
// 证明工厂函数能跑；组件真正被调用时才会暴露出拼错的字段、写反的条件、漏传的
// 回调。这里没有浏览器，只有一个小到不能再小的 React 替身：hooks 按实例存状态，
// onClick 就是真的 prop，点一下 = 调一次。
//
// 守的是四条不变式：
//   (a) 卡片永远并排给出 原文 | 改后，并且有待定的 接受/拒绝 两个动作；
//   (b) 接受只上报，不改正文（"接受"是决定，不是替作者动笔）；
//   (c) 已接收按区域分组，同一区域两次以上带 ①②③ 顺序标记，折叠在下方；
//   (d) 悬浮坞的角度 chip 可空可取消——不选就走输入框的要求。
//
// 用法：node scripts/verify-advice-ui.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'client', 'src', '92-advice.js'), 'utf8');

// The components attach window listeners in effects; the harness has no DOM.
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id),
};

const START = '/* ========================== R73';
const END = '  NW.Advice = Advice;';
const a = src.indexOf(START);
const b = src.indexOf(END, a);
if (a < 0 || b < 0) {
  console.error('could not find the R73 component block');
  process.exit(1);
}
const block = src.slice(a, b);

// ---------------------------------------------------------------- mini react --
const instances = new Map();
let cur = null;
let hookIdx = 0;
let rootTree = null;
let dirty = false;
let rendering = false;

function createElement(type, props, ...children) {
  const p = Object.assign({}, props || {});
  if (children.length) p.children = children.length === 1 ? children[0] : children;
  return { $$el: true, type, props: p };
}

function useState(initial) {
  const inst = cur;
  const i = hookIdx++;
  if (!(i in inst.hooks)) inst.hooks[i] = typeof initial === 'function' ? initial() : initial;
  const set = (v) => {
    const next = typeof v === 'function' ? v(inst.hooks[i]) : v;
    if (Object.is(next, inst.hooks[i])) return;
    inst.hooks[i] = next;
    schedule();
  };
  return [inst.hooks[i], set];
}
function useRef(initial) {
  const inst = cur;
  const i = hookIdx++;
  if (!(i in inst.hooks)) inst.hooks[i] = { current: initial };
  return inst.hooks[i];
}
function useCallback(fn) {
  hookIdx++;
  return fn;
}
function useMemo(fn) {
  hookIdx++;
  return fn();
}
function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}
function useEffect(fn, deps) {
  const inst = cur;
  const i = hookIdx++;
  const slot = inst.effectSlots[i];
  if (!slot || !sameDeps(slot, deps)) inst.effects.push({ i, fn, deps });
}

function schedule() {
  dirty = true;
  if (!rendering) flush();
}

function render(node, path) {
  if (node == null || node === false || node === true) return null;
  if (Array.isArray(node)) return node.map((child, i) => render(child, path + '.' + i));
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node.type === 'function') {
    const key = path + '|' + (node.type.name || 'anon');
    let inst = instances.get(key);
    if (!inst) {
      inst = { hooks: [], effects: [], effectSlots: [], name: node.type.name };
      instances.set(key, inst);
    }
    const prev = cur;
    const prevIdx = hookIdx;
    cur = inst;
    hookIdx = 0;
    inst.effects = [];
    let out;
    try {
      out = node.type(node.props);
    } finally {
      cur = prev;
      hookIdx = prevIdx;
    }
    return { tag: '#comp', name: node.type.name, inst, child: render(out, key) };
  }
  const p = node.props || {};
  const kids = p.children == null ? [] : Array.isArray(p.children) ? p.children : [p.children];
  return {
    tag: node.type,
    props: p,
    children: kids.map((c, i) => render(c, path + '/' + i)).filter((x) => x != null),
  };
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children) + (node.child ? textOf(node.child) : '');
}

function collect(node, out) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  if (typeof node === 'string') return out;
  if (node.tag === '#comp') return collect(node.child, out);
  out.push(node);
  node.children.forEach((n) => collect(n, out));
  return out;
}

const rootHolder = { el: null };

function flush() {
  rendering = true;
  for (let guard = 0; dirty && guard < 40; guard += 1) {
    dirty = false;
    for (const inst of instances.values()) inst.effects = [];
    rootTree = render(rootHolder.el, 'root');
    for (const inst of instances.values()) {
      for (const e of inst.effects) {
        inst.effectSlots[e.i] = e.deps || [];
        try {
          e.fn();
        } catch (err) {
          console.error('effect threw: ' + err.message);
        }
      }
    }
  }
  rendering = false;
}

function mount(el) {
  instances.clear();
  rootHolder.el = el;
  dirty = true;
  flush();
  return rootTree;
}

// ---------------------------------------------------------------- NW stubs ---
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const calls = { accept: [], remove: [], ai: 0 };

function tpl(key, ...args) {
  let s = String(key);
  args.forEach((arg, i) => {
    s = s.split('{' + i + '}').join(String(arg));
  });
  return s;
}

const NW = {
  t: tpl,
  icon: (name) => createElement('i', { 'data-icon': name }),
  fmtDate: () => '11-07',
  ui: {
    btn: (o) => createElement('button', { className: 'btn', onClick: o.onClick, disabled: o.disabled }, o.children),
    iconBtn: (label, title, onClick) => createElement('button', { className: 'iconbtn', title, onClick }, label),
    spinner: () => createElement('span', { className: 'spinner' }, '…'),
  },
};

const BASE_TEXT = '他把门推开，屋子里很安静。桌上那本书还摊着，像在等他回来。';
let editorText = BASE_TEXT;
const fakeEditor = {
  current: {
    getContent: () => editorText,
    replaceRange: (start, end, text) => {
      const s = Math.max(0, Number(start) || 0);
      const e = Math.max(s, Number(end) || s);
      editorText = editorText.slice(0, s) + String(text == null ? '' : text) + editorText.slice(e);
      calls.replaced = [s, e, String(text)];
    },
    setHighlights: (list) => {
      calls.highlight = list;
    },
    centerRange: (s, e) => {
      calls.center = [s, e];
    },
  },
};

// ---------------------------------------------------------------- load code --
// R78: the advice block lives in 92-advice.js now; the slice already carries its
// own errText / clampNum helpers, so they are no longer injected.
const factory = new Function(
  'h',
  'React',
  'NW',
  'useState',
  'useRef',
  'useCallback',
  'useMemo',
  'useEffect',
  `${block}\nreturn { AdviceCard, AcceptedPanel, Advice, SelectionAdvice, ordinalMark, groupRevisions, locateRevision };`,
);
const C = factory(
  createElement,
  { useEffect, useRef, useState },
  NW,
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
);

// ---------------------------------------------------------------- assertions --
let failed = 0;
const check = (name, ok, extra) => {
  if (!ok) {
    failed += 1;
    console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : ''));
  } else {
    console.log('  ok   ' + name);
  }
};
const text = (el) => textOf(mount(el));
const nodes = () => collect(rootTree, []);
const clickText = (label) => {
  const hit = nodes().find((n) => n.tag === 'button' && textOf(n).includes(label));
  if (!hit) throw new Error('no button: ' + label);
  hit.props.onClick({ stopPropagation() {}, preventDefault() {} });
  return hit;
};

// ---- 1. AdviceCard -----------------------------------------------------------
console.log('[1] AdviceCard');
let accepted = null;
text(
  createElement(C.AdviceCard, {
    item: { id: 'a1', quote: '屋子里很安静', revised: '屋里静得能听见心跳', issue: '交代不是画面', why: '声音更近', kind: 'detail' },
    state: 'pending',
    onAccept: (item) => {
      accepted = item;
    },
    onReject: () => {},
  }),
);
check('并排两栏：原文 / 改后', /原文/.test(textOf(rootTree)) && /改后/.test(textOf(rootTree)));
check('有 接受 / 拒绝 按钮', /接受/.test(textOf(rootTree)) && /拒绝/.test(textOf(rootTree)));
// R76 (A2): the two columns are a character diff, not two plain paragraphs.
check(
  '字符级差异：删掉的字/补上的字都有标记',
  nodes().some((n) => n.tag === 'mark' && n.props.className === 'nw-diff-del')
    && nodes().some((n) => n.tag === 'mark' && n.props.className === 'nw-diff-add'),
  nodes().filter((n) => n.tag === 'mark').map((n) => n.props.className),
);
clickText('接受');
check('点接受把整条交给上层', accepted && accepted.quote === '屋子里很安静', accepted && accepted.quote);

let rejected = null;
text(
  createElement(C.AdviceCard, {
    item: { id: 'a2', quote: '像在等他回来', revised: '像是他没走时留在那儿的' },
    state: 'pending',
    onReject: (item) => {
      rejected = item;
    },
  }),
);
clickText('拒绝');
check('点拒绝回调带上条目', rejected && rejected.id === 'a2');

text(createElement(C.AdviceCard, { item: { id: 'a3', quote: 'q' }, state: 'accepted', onUndo: () => {} }));
check('已接受态显示「已接受」并给撤销', /已接受/.test(textOf(rootTree)) && /撤销/.test(textOf(rootTree)));

// ---- 2. AcceptedPanel --------------------------------------------------------
console.log('[2] AcceptedPanel（同一区域两次修改）');
const rows = [
  { id: 'r1', quote: '屋子里很安静', revised: '屋里静得能听见心跳', createdAt: 1000, start: 8, end: 14 },
  { id: 'r2', quote: '屋子里很安静', revised: '屋里一点声响都没有', createdAt: 2000, start: 8, end: 14 },
  { id: 'r3', quote: '像在等他回来', revised: '像是他还坐在那儿', createdAt: 3000, start: 31, end: 37 },
];
const collapsed = text(
  createElement(C.AcceptedPanel, { rows, getText: () => fakeEditor.current.getContent(), onReveal: () => {} }),
);
check('折叠时列出条数', /已接收/.test(collapsed) && /3 条/.test(collapsed));
check('折叠时分成 2 处', /2 处/.test(collapsed), collapsed.match(/\d+ 处/));
clickText('已接收');
const opened = textOf(rootTree);
check('展开后同一区域按顺序编号 ① ②', /①/.test(opened) && /②/.test(opened), opened.slice(0, 80));
check('不同区域不带序号', (opened.match(/③/g) || []).length === 0);

// ---- 3. SelectionAdvice ------------------------------------------------------
console.log('[3] SelectionAdvice');
const content = fakeEditor.current.getContent();
const selStart = content.indexOf('屋子里很安静');
const selEnd = selStart + '屋子里很安静'.length;
const offsetOf = (needle) => content.indexOf(needle) - selStart;
const suggestions = [
  { quote: '屋子里很安静', revised: '屋里静得能听见心跳', issue: '交代', why: '更近', kind: 'detail', start: 0, end: 6 },
  { quote: '像在等他回来', revised: '像是他还坐在那儿', kind: 'diction', start: offsetOf('像在等他回来'), end: offsetOf('像在等他回来') + 7 },
];
let streamCalls = [];
let streamSeq = 0;
NW.ai = {
  // R76: the window uses the streaming route when it exists.
  reviseSelectionStream: async (input, handlers) => {
    streamCalls.push(input);
    const out = [];
    for (const item of suggestions) {
      streamSeq += 1;
      const next = Object.assign({}, item, { id: 'x' + streamSeq });
      out.push(next);
      handlers.onEvent({ type: 'suggestion', item: next });
      // eslint-disable-next-line no-await-in-loop
      await tick(0);
    }
    return { suggestions: out, model: 'p/m' };
  },
  reviseSelectionSafe: async () => {
    calls.ai += 1;
    return { suggestions: [], model: 'fallback' };
  },
};
const acceptedRows = [];
const sel = { start: selStart, end: selEnd, text: '屋子里很安静' };
const mountWindow = () =>
  mount(
    createElement(C.SelectionAdvice, {
      chapter: { id: 'c1' },
      editorApi: fakeEditor,
      selection: sel,
      accepted: acceptedRows,
      onAccept: async (draft) => {
        acceptedRows.push(Object.assign({ id: 'new', createdAt: 4000 }, draft));
        return { id: 'new' };
      },
      onRemoveAccepted: async (row) => {
        calls.remove.push(row.id);
      },
      onToast: () => {},
      onClose: () => {
        calls.closed = true;
      },
    }),
  );
mountWindow();
await tick(20);
let view = textOf(rootTree);
check('打开即发起流式请求', streamCalls.length === 1 && calls.ai === 0, { stream: streamCalls.length, unary: calls.ai });
check('请求里带上了选中的文字', streamCalls[0] && streamCalls[0].text === '屋子里很安静', streamCalls[0] && streamCalls[0].text);
check('请求里带了上下文', !!streamCalls[0] && typeof streamCalls[0].before === 'string' && typeof streamCalls[0].after === 'string');
check('卡片出现', /屋里静得能听见心跳/.test(view));
check('选中的原文显示在顶部', /屋子里很安静/.test(view));
check('两张流式卡片都在', nodes().filter((n) => n.tag === 'div' && n.props.className === 'nw-adv').length === 2);

// R76 (A1): 替换到正文 / 撤销替换
check('卡片上有复制 / 替换 / 再改一版', /复制/.test(view) && /替换到正文/.test(view) && /再改一版/.test(view));
clickText('替换到正文');
await tick(10);
check('替换真的写进了正文', fakeEditor.current.getContent().indexOf('屋里静得能听见心跳') >= 0, fakeEditor.current.getContent());
check('替换记下了原文与改写', calls.replaced && calls.replaced[0] === selStart && calls.replaced[2] === '屋里静得能听见心跳', calls.replaced);
check('替换后按钮变成撤销替换', /撤销替换/.test(textOf(rootTree)));
clickText('撤销替换');
await tick(10);
check('撤销把原文放回去了', fakeEditor.current.getContent() === BASE_TEXT, fakeEditor.current.getContent());

// 接受仍然是「只记账」
clickText('接受');
await tick(10);
view = textOf(rootTree);
check('接受后卡片转绿标「已接受」', /已接受/.test(view));
check('接受写进上层（source=selection）', acceptedRows.length === 1 && acceptedRows[0].source === 'selection', acceptedRows[0] && acceptedRows[0].source);
check('接受不动正文', fakeEditor.current.getContent() === BASE_TEXT);

// R76 (C3): 再改一版
clickText('再改一版');
await tick(20);
check('再改一版把上一版作为 previous 发出去', streamCalls.length === 2 && streamCalls[1].previous === '屋里静得能听见心跳', streamCalls[1] && streamCalls[1].previous);
check('新一版带「第 2 版」标记', /第 2 版/.test(textOf(rootTree)), textOf(rootTree).slice(0, 80));

// R76 (A3): 关掉再打开同一段，不该再请求
const callsBefore = streamCalls.length;
mountWindow();
await tick(20);
check('重开同一段命中缓存，不再请求', streamCalls.length === callsBefore, { before: callsBefore, after: streamCalls.length });
check('缓存来的结果标了「上次的结果」', /上次的结果/.test(textOf(rootTree)));

// ---- 4. 点击卡片定位正文 -----------------------------------------------------
console.log('[4] 点击卡片高亮正文');
calls.highlight = null;
const card = nodes().find((n) => n.tag === 'div' && n.props.className === 'nw-adv');
card.props.onClick();
check(
  '点卡片把正文对应句高亮',
  calls.highlight && calls.highlight[0].start === selStart && calls.highlight[0].end === selStart + 6,
  calls.highlight && calls.highlight[0],
);

// ---- 5. Advice（悬浮坞里的修改建议栏） ---------------------------------------
console.log('[5] Advice 栏：角度可选 + 接受');
const focusCalls = [];
NW.ai.reviseSafe = async (input) => {
  focusCalls.push(input.focus === undefined ? null : input.focus);
  return {
    suggestions: [
      { id: 'r1', quote: '屋子里很安静', issue: '交代', advice: '写声音', example: '屋里静得能听见心跳', kind: 'detail', start: selStart, end: selEnd },
    ],
    model: 'p/m',
  };
};
const dockAccepted = [];
mount(
  createElement(C.Advice, {
    chapter: { id: 'c1' },
    editorApi: fakeEditor,
    settings: {},
    accepted: dockAccepted,
    onAccept: async (draft) => {
      dockAccepted.push(Object.assign({ id: 'd1', createdAt: 5000 }, draft));
      return { id: 'd1' };
    },
    onRemoveAccepted: async () => {},
    onClose: () => {},
    onToast: () => {},
  }),
);
let dock = textOf(rootTree);
check('角度说明写明可空、可多选', /角度可多选|角度可以不选/.test(dock), dock.slice(0, 60));
check('默认没有选中任何角度 chip', !nodes().some((n) => n.tag === 'button' && n.props['data-on'] === '1'));
const chipOf = (label) => nodes().find((n) => n.tag === 'button' && textOf(n) === label);
// R75: a chip press must ONLY toggle. R74 fired the request 420ms after the
// last press — shorter than the time it takes to decide on a second angle, so
// the chapter was already being read and the pills were disabled by then. The
// read now starts only from 「开始审读」 / 「重新审读」 / Enter.
chipOf('节奏').props.onClick();
chipOf('用词').props.onClick();
await tick(520);
check('点角度不发请求', focusCalls.length === 0, focusCalls);
check('两颗 chip 同时亮着', chipOf('节奏').props['data-on'] === '1' && chipOf('用词').props['data-on'] === '1');
check('提示写着已选 2 个', /已选 2 个角度/.test(textOf(rootTree)), textOf(rootTree).slice(0, 40));
clickText('开始审读');
await tick(10);
check('开始审读才发一次请求，带两个角度', focusCalls.length === 1 && focusCalls[0] === 'rhythm,diction', focusCalls);
chipOf('节奏').props.onClick();
await tick(520);
check('取消一个角度不发请求', focusCalls.length === 1, focusCalls);
clickText('重新审读');
await tick(10);
check('重新审读带上剩下的 diction', focusCalls[1] === 'diction', focusCalls);
chipOf('用词').props.onClick();
await tick(520);
check('全部取消也不发请求', focusCalls.length === 2, focusCalls);
clickText('重新审读');
await tick(10);
check('全部取消后发空角度（按输入框来）', focusCalls[2] === '', focusCalls);
dock = textOf(rootTree);
check('悬浮坞卡片也是并排 + 接受/拒绝', /原文/.test(dock) && /改后/.test(dock) && /接受/.test(dock));
clickText('接受');
await tick(10);
check('悬浮坞接受写入 source=chapter', dockAccepted.length === 1 && dockAccepted[0].source === 'chapter', dockAccepted[0] && dockAccepted[0].source);
check('接受的那条带 example 作为改后', dockAccepted[0] && dockAccepted[0].revised === '屋里静得能听见心跳');

console.log(failed === 0 ? '\n全部通过 ✅' : '\n失败 ' + failed + ' 项 ❌');
process.exit(failed === 0 ? 0 : 1);

