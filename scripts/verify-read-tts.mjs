// 朗读（TTS）审计。
//
// 为什么要有这个脚本：朗读用的全是浏览器自带的能力，没有任何接口能「编译期」
// 发现它坏掉。一旦 `speechSynthesis` 那一段被改坏，症状极其安静——按了没声音、
// 或者念到第一段就停、或者关掉阅读页还在念。这三种都不报错，只能靠断言盯着。
//
// 断言的是四件事：
//   ① 界面在：喇叭图标、条上的开关、设置浮层、正在念的那一段的高亮；
//   ② 真在念：按段落切分、`SpeechSynthesisUtterance`、`onend` 接着念下一段；
//   ③ 不闯祸：卸载时 `cancel()`、没有引擎时静默；系统语音那条路不联网，
//      在线（微软 / 百度）与自定义两条路必须走宿主那条路由，且界面要说清
//      「正文会离开本机」；
//   ④ 偏好留得住：语速与音色落在 localStorage，下次还认。
//
// 用法：node scripts/verify-read-tts.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '..', 'client', 'src', name), 'utf8');

const icons = read('42-icons.js');
const reader = read('62-read.js');

const problems = [];
const notes = [];
const has = (src, re, label, where) => {
  if (!re.test(src)) problems.push(`${where} 里找不到「${label}」`);
};
const hasNot = (src, re, label, where) => {
  if (re.test(src)) problems.push(`${where} 里不该出现「${label}」`);
};

// 只检查朗读那一段，避免被文件里别处的同名字样蒙过去。
const start = reader.indexOf('R130：念给我听');
const endMark = 'const startSpeakHere';
const end = reader.indexOf(endMark);
if (start < 0 || end < 0 || end < start) {
  problems.push('62-read.js 里找不到朗读逻辑（R130 注释 → startSpeakHere 之间）');
}
const speak = start >= 0 && end > start ? reader.slice(start, end) : '';

// ---- ① 图标与界面 ----------------------------------------------------------
has(icons, /\n\s{4}volume:\s*\[/, 'volume 图标', '42-icons.js');
has(icons, /\n\s{4}volumeoff:\s*\[/, 'volumeoff 图标', '42-icons.js');
notes.push('图标：volume / volumeoff（同一个喇叭，切换不跳）');

has(reader, /\.nw-read-speakbar\{/, '.nw-read-speakbar', '62-read.js');
has(reader, /\.nw-read-bar-btn\[data-on="1"\]\{/, '朗读者按下时的样式', '62-read.js');
has(reader, /\.nw-read-speakmenu\{/, '朗读设置浮层', '62-read.js');
has(reader, /\.nw-read-p\.is-speaking\{/, '正在念的那一段的高亮', '62-read.js');
notes.push('界面：条上的喇叭 + 设置浮层 + 段落高亮');

has(reader, /aria-pressed': speaking \? 'true' : 'false'/, '喇叭的 aria-pressed', '62-read.js');
has(reader, /NW\.t\('念给我听'\)/, '喇叭文案「念给我听」', '62-read.js');
notes.push('无障碍：喇叭是 toggle，带 aria-pressed 与朗读/停止两套文案');

// ---- ② 真的在念 ------------------------------------------------------------
has(speak, /querySelectorAll\('p\.nw-read-p'\)/, '按段落取文本', '朗读段');
has(speak, /new window\.SpeechSynthesisUtterance\(text\)/, 'SpeechSynthesisUtterance', '朗读段');
has(speak, /u\.onend = \(\) => \{/, '念完接着下一段', '朗读段');
has(speak, /u\.rate = speakRate;/, '语速生效', '朗读段');
has(speak, /u\.lang = \(voice && voice\.lang\) \|\| 'zh-CN';/, '中文音色优先', '朗读段');
has(speak, /scrollToPage\(Math\.max\(0, Math\.min\(maxPage, page\)\)\)/, '念到下一页自动翻页', '朗读段');
notes.push('朗读：一段一条 utterance，念完递归下一段，换页时瞬移翻页');

// 为什么要分段：Chrome 对十几秒以上的长 utterance 会自己停住。
has(speak, /一次只念一段/, '分段的理由（注释）', '朗读段');
notes.push('分段：一次一条，避开浏览器对长 utterance 的自动截停');

// ---- ③ 不闯祸 --------------------------------------------------------------
has(reader, /React\.useEffect\(\(\) => \(\) => \{\n\s*const synth = typeof window !== 'undefined' \? window\.speechSynthesis : null;/, '卸载时停声', '62-read.js');
has(speak, /try \{ synth\.cancel\(\); \} catch \(err\)/, 'cancel 有 try/catch', '朗读段');
has(speak, /typeof window !== 'undefined' \? window\.speechSynthesis : null/, 'speechSynthesis 有存在性守卫', '朗读段');
has(speak, /if \(!synth \|\| !flow\) return;/, '没有引擎就静默', '朗读段');
notes.push('稳健：卸载即 cancel，没有引擎不弹框（朗读是锦上添花）');

// R131：三条引擎，每条的可信度不同，断言也跟着分开：
//   system — 渲染进程自己念，绝不许出现网络调用；
//   edge / baidu / api — 必须走 `NW.io.tts.speak`（宿主路由），不许在渲染进程里
//     自己 fetch 外部地址（会被 CORS 和密钥挡下来，也会把密钥暴露给页面）。
hasNot(speak, /fetch\(|XMLHttpRequest/, '渲染进程里直连网络', '朗读段');
has(speak, /NW\.io\.tts[\s\S]{0,40}\.speak\(/, '在线/自定义引擎走宿主路由', '朗读段');
has(speak, /pending\[at\] = job;/, '预取的请求缓存在 pending 表里', '朗读段');
has(speak, /URL\.createObjectURL\(blob\)/, '音频用 object URL 播放', '朗读段');
has(speak, /URL\.revokeObjectURL\(url\)/, 'object URL 用完就撤', '朗读段');
has(speak, /speakRef\.current\.audio \|\| \(typeof Audio === 'function'/, '复用一个 Audio 元素', '朗读段');
has(speak, /if \(cfgRef\.current\.engine !== 'system'\)/, '系统语音与在线引擎分流', '朗读段');
notes.push('引擎：系统（本机、不联网）/ 微软 / 百度 / 自定义（后三者走宿主路由）');

// 界面必须自己把「正文会离开本机」说出来，不能只在 README 里写。
has(reader, /这一段正文会联网发给微软/, '微软引擎的联网说明', '62-read.js');
has(reader, /这一段正文会联网发给百度/, '百度引擎的联网说明', '62-read.js');
has(reader, /设置 → 阅读/, '自定义接口的设置位置提示', '62-read.js');
has(reader, /403/, '微软 403 的可读提示', '62-read.js');
notes.push('说明：联网引擎在界面上写明正文会外发，403 给出可执行的下一步');

// 宿主那一层：引擎实现、路由方法、密钥不进日志。
const host = readFileSync(join(here, '..', 'lib', 'tts.js'), 'utf8');
if (!/export async function synthesize/.test(host)) problems.push('lib/tts.js 缺少 synthesize()');
if (!/speech\.platform\.bing\.com/.test(host)) problems.push('lib/tts.js 缺少微软在线语音端点');
if (!/fanyi\.baidu\.com\/gettts/.test(host)) problems.push('lib/tts.js 缺少百度朗读端点');
if (!/v1\/audio\/speech/.test(host)) problems.push('lib/tts.js 缺少 OpenAI 兼容接口路径');
const routes = readFileSync(join(here, '..', 'lib', 'routes.js'), 'utf8');
if (!/case 'tts':/.test(routes)) problems.push('lib/routes.js 没有注册 tts 方法');
if (!/handleTts\(payload\)/.test(routes)) problems.push('lib/routes.js 没有接上 handleTts');
if (/console\.(log|warn|error)\([^)]*api\.key/.test(host)) problems.push('lib/tts.js 不该把密钥写进日志');
notes.push('宿主：微软 / 百度 / OpenAI 兼容三种实现，一个 tts 方法，密钥只随请求走');

// 设置浮层的两种收起手势：点别处、Esc（Esc 不能连带把整本书关掉）。
has(reader, /closest\('\.nw-read-speakbar'\)/, '点别处收浮层', '62-read.js');
has(reader, /ev\.stopPropagation\(\);\n\s*setSpeakMenu\(false\);/, 'Esc 只收浮层', '62-read.js');
notes.push('浮层：点别处或按 Esc 收起，Esc 不会顺着把阅读页关掉');

// ---- ④ 偏好留得住 ----------------------------------------------------------
has(reader, /'nw\.tts\.' \+ key/, 'localStorage 前缀 nw.tts.', '62-read.js');
has(reader, /writeSpeakPref\('rate', value\)/, '语速写盘', '62-read.js');
has(reader, /writeSpeakPref\('voice', next\)/, '音色写盘', '62-read.js');
has(reader, /\[0\.8, 1, 1\.2, 1\.5\]/, '语速四档', '62-read.js');
notes.push('偏好：语速 0.8/1/1.2/1.5× 与音色落在 localStorage，只影响听感不进 settings');

// ---- 报告 ------------------------------------------------------------------
for (const line of notes) console.log('  · ' + line);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(`\n结果: ${problems.length} 处问题`);
  process.exit(1);
}
console.log('\n结果: 全部通过 ✅（喇叭 → 逐段朗读 → 换页 → 卸载停声 → 偏好留得住）');
