// 目录里的「读这一章 / 读整本」审计。
//
// 为什么要有这个脚本：这两个入口横跨四个文件——图标（42-icons）、目录行与菜单
// 与底栏（50-shelf）、状态与接线（90-app）、阅读页的起读章（62-read）。任何一段
// 被删掉，症状都不是报错，而是「点了没反应」或者「点了却从编辑器当前章读起」，
// 后者尤其难发现：阅读页确实开了，只是停错页。
//
// 断言的都是「这条链路还在」这件事本身：
//   ① 图标表里有 openbook，两个入口都用它；
//   ② 目录的章节行、章节菜单、书籍行、目录底栏各自有入口；
//   ③ App 有 readAt 状态、传给 ReadView 的 startId、退出时清空；
//   ④ 阅读页真的用 startId 做开场定位（而不是 currentId）；
//   ⑤ 「读另一本书」时先等章节到位再开（readPendingRef）。
//
// 用法：node scripts/verify-read-entry.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '..', 'client', 'src', name), 'utf8');

const icons = read('42-icons.js');
const shelf = read('50-shelf.js');
const app = read('90-app.js');
const reader = read('62-read.js');

const problems = [];
const notes = [];
const has = (src, re, label, where) => {
  if (!re.test(src)) problems.push(`${where} 里找不到「${label}」`);
};

// ---- ① 图标 ----------------------------------------------------------------
has(icons, /\n\s{4}openbook:\s*\[/, 'openbook 图标', '42-icons.js');
notes.push('图标：openbook（摊开的书）');

// ---- ② 目录里的四个入口 ----------------------------------------------------
has(shelf, /api\.readChapter = \(ch\) => \{/, 'api.readChapter', '50-shelf.js');
has(shelf, /makeIconBtn\(icon\('openbook'\), tr\('读这一章'\), \(\) => api\.readChapter\(ch\)\)/, '章节行的「读这一章」', '50-shelf.js');
has(shelf, /makeIconBtn\(icon\('openbook'\), tr\('读整本'\), \(\) => \{[\s\S]*?onReadBook/, '书籍行的「读整本」', '50-shelf.js');
has(shelf, /makeIconBtn\(icon\('openbook', 18\), tr\('读整本'\)/, '目录底栏的「读整本」', '50-shelf.js');
has(shelf, /menu\.kind === 'chapter'\s*\? menuItem\(\s*'openbook',\s*tr\('读这一章'\)/s, '章节菜单的「读这一章」', '50-shelf.js');
has(shelf, /tr\('读整本'\),\s*\(\) => \{\s*if \(typeof P\.onReadBook === 'function'\) P\.onReadBook\(menu\.id\)/s, '书籍菜单的「读整本」', '50-shelf.js');
notes.push('目录入口：章节行 / 章节菜单 / 书籍行 / 目录底栏 各一个');

// ---- ③ App 的接线 ----------------------------------------------------------
has(app, /const \[readAt, setReadAt\] = useState\(null\);/, 'readAt 状态', '90-app.js');
// R138：阅读入口统一走 openRead(id)——它把 startId、开卷、真全屏三件事一起做。
has(app, /onReadChapter: \(id\) => \{[\s\S]{0,120}?openRead\(id\);/, 'onReadChapter 接线', '90-app.js');
has(app, /const openRead = useCallback\(\(startId\) => \{[\s\S]{0,260}?setReadAt\(startId == null \? null : startId\);/, 'openRead 写入 startId', '90-app.js');
has(app, /setReadOpen\(true\);\s*\n\s*enterFullscreen\(\);/, 'openRead 在点击里要真全屏', '90-app.js');
has(app, /onReadBook: \(novelId\) => \{/, 'onReadBook 接线', '90-app.js');
has(app, /startId: readAt,/, 'ReadView 的 startId', '90-app.js');
has(app, /const readPendingRef = useRef\(null\);/, 'readPendingRef', '90-app.js');
has(app, /readPendingRef\.current = \{ novelId: target \};/, '换书时的待读记录', '90-app.js');
has(app, /onClose: \(\) => \{\s*setReadOpen\(false\);\s*setReadAt\(null\);/, '退出时清空 readAt', '90-app.js');
notes.push('App：readAt / startId / 换书排队 / 退出清空');

// ---- ④ 阅读页真的按 startId 起读 ------------------------------------------
has(reader, /const startId = p\.startId == null \? currentId : String\(p\.startId\);/, 'startId 取值', '62-read.js');
has(reader, /const mark = marksRef\.current\[startId\];/, '开场用 startId 定位', '62-read.js');
has(reader, /\[fontSize, lineHeight, readColumns, currentId, startId, chapters, abortTurn\]/, 'measure 依赖含 startId', '62-read.js');
if (/const mark = marksRef\.current\[currentId\];/.test(reader)) {
  problems.push('62-read.js 的开场定位又用回 currentId 了：目录里「读这一章」会停错页');
}
notes.push('阅读页：开场用 startId（不是 currentId）定位那一章');

// ---- ⑤ 不许切编辑器的当前章 ------------------------------------------------
// 「读一章」只是开个阅读页；如果顺手 selectChapter，退出后光标就被搬到别处了。
const onReadChapter = app.slice(app.indexOf('onReadChapter:'), app.indexOf('onReadBook:'));
if (/selectChapter\s*\(/.test(onReadChapter)) {
  problems.push('onReadChapter 里调用了 selectChapter：读一章不该改变写作上下文');
}

// ---- 报告 ------------------------------------------------------------------
for (const line of notes) console.log('  · ' + line);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n结果: ${problems.length} 处问题`);
  process.exit(1);
}
console.log('\n结果: 全部通过 ✅（章节行 / 章节菜单 / 书籍行 / 目录底栏 → startId → 开场定位）');
