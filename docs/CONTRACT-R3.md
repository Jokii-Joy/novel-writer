# 第三轮改造 · 集成契约（所有人必读）

用户第三轮反馈（逐条，务必全部覆盖）：
1. 阿里云盘「不能用 / 找不到 / 不会用」→ **必须简化**，默认路径不要让人填 Client ID。
2. **整体操作要有动画交互**。
3. **不要跑测试**（用户自己测）。开发只需 `node --check` 保语法、`node scripts/build-client.mjs` 由 lead 统一做。
4. 沉浸模式**去掉最上方那条横栏**，只用 `Esc` 退出。
5. 创作台自己的**侧边栏可隐藏**。
6. 侧栏下方功能按钮**太小 → 放大**。
7. 编辑器上方横栏**不必要的功能移进设置**。
8. **校对 / 排版 / 投稿悬浮在右下角**，不能挡输入区。
9. **导入放左侧栏**；**导出放「书籍 / 章节」的选项菜单**里。
10. 本地文件**没有加密** → 给出好的加密方案。
11. 主题改为五套：**harness 默认 / 护眼 / 黑夜 / 水墨 / claude**。
12. **光标加粗加黑**。
13. 整个页面 **Claude 设计风格**。
14. 设置里增加**导出文件相关选项**。
15. 支持**导出文件末尾追加固定内容**（可修改）。
16. **投稿功能**：内置文学期刊投稿要求与邮箱、登录用户邮箱（SMTP）、选期刊 + 体裁（微小说/短篇/中篇/长篇）+ 稿件、一键投稿、自动检测并调整格式、自动写投稿邮件、**预览确认后才投**。

---

## 0. 硬规则（违反则整包不可用）

- Host 只用 **Node 内置模块**；Client 只用纯浏览器 JS（无 import/export/JSX/TS），`require` 只允许 `'react'`。
- 禁止 `require('@deepseek-ai/dsh-client-ui-primitives')`；禁止写 `document.body`；禁止 iframe。
- 颜色：宿主 chrome 只用 `--dsw-alias-*`；写作面可用自有 `--nw-*`。**不要出现字面色值以外的随意硬编码**（渐变/阴影允许 `rgba(0,0,0,...)` 中性值）。
- 文案走 `NW.t('中文')`；`NW.t` 缺词典时原样返回中文，可接受。
- **CSS 模板字符串内部注释里绝对不能出现反引号**（会提前闭合模板字符串，本会话已踩两次）。
- 每个 part 文件必须是独立 `;(() => { 'use strict'; ... })();` IIFE，不得有 IIFE 外顶层声明。
- 提交前每个改过的文件跑 `node --check <file>` 必须 exit 0。**不要跑 build，不要跑任何测试套件。**

## 1. 文件归属（严格互斥，不得越界）

| 文件 | 归属 |
| --- | --- |
| `client/src/05-css.js` `97-theme.js` `45-dialogs-css.js` `98-shell-theme.js` + 可新建 `96-motion.js` | theme3 |
| `client/src/60-editor.js` | editor3 |
| `client/src/50-shelf.js` | shelf3 |
| `client/src/95-dialogs.js` | dialog3 |
| `lib/*.js`（可新建 smtp.js / journals.js） | host3 |
| `client/src/90-app.js` `10-db.js` `30-io.js` `07-locale.js` `40-ui.js` `index.js` `README.md` | **lead**（其他人只读） |

## 2. 主题：五套 + 命名（全局唯一真源）

`settings.theme` 取值：`'harness' | 'eye' | 'night' | 'ink' | 'claude'`，**默认 `'claude'`**。

| id | 名称 | 定位 |
| --- | --- | --- |
| `harness` | Harness 默认 | 不重映射，完全跟随宿主 token（`98-shell-theme.js` 里**不写**该选择器分支）；写作面用中性白纸 |
| `claude` | Claude | 暖纸 `#faf9f5`、墨字 `#141413`、陶土强调 `#d97757`、边框 `#e8e6dc` |
| `eye` | 护眼 | 绿纸 `#cce8cf` / 深墨绿字 |
| `night` | 黑夜 | `#1a1a18` / `#e8e6dc`，强调 `#d97757` 提亮为 `#e08d6f` |
| `ink` | 水墨 | 宣纸 `#f4f2ec` / 墨 `#1a1a18`，强调为墨色 `#2b2b28`，无彩色 |

- 写作面（editor3）与外壳（theme3 的 `98-shell-theme.js`）**必须使用同一组 id**。
- `client/src/90-app.js` 根节点已输出 `data-theme={settings.theme}`，并把旧值迁移为 `light→claude`、`dark→night`、`eye→eye`、`parchment→ink`（lead 负责）。
- 编辑器四套调色板在 `60-editor.js` 的 `THEMES` 与 `[data-theme="…"]` 块中（editor3 改为五套；`harness` 用中性白纸 `#ffffff/#1f1f1f`）。
- `98-shell-theme.js` 负责在 `.nw-root[data-theme="claude"|"eye"|"night"|"ink"]` 作用域内重映射 14 个 `--dsw-alias-*` + `--dsw-specific-sidebar-fill` + `color-scheme`。

## 3. Claude 设计语言（theme3 主导，其他文件只引用变量）

- 字体：正文衬线（`--nw-reading-font`），UI 用系统 sans（`--nw-ui-font`）。
- **字号再放大**：UI 基准 **16px**、次级 14px、小字 13px；正文默认字号由 `10-db.js` 默认值决定（lead 改 19→20），行高 2.0。
- 圆角：卡片 12、控件 10、模态 16、pill 999。
- 控件高度：按钮 **36px**、图标按钮 **34×34**、输入 **38px**、工具栏 **52px**、状态栏 **34px**。
- 强调色仅用于：主按钮、焦点环、激活项左侧 3px 条、选中背景淡染。
- 阴影克制：`0 1px 2px rgba(0,0,0,.04)` + `0 8px 24px rgba(0,0,0,.06)`（悬停/浮层）。
- 动画：统一 `--nw-ease: cubic-bezier(.2,.7,.2,1)`、`--nw-dur: .18s`；所有可交互元素要有 hover/active 过渡；模态 进场 `nw-fade-up`（opacity+translateY 6px），toast `nw-toast-in`，侧栏折叠 `nw-slide`，浮动坞展开 `nw-pop`。**必须** `@media (prefers-reduced-motion: reduce)` 全部关掉。

## 4. 光标加粗加黑（editor3）

- 目标：正文光标明显可见。实现：**隐藏原生 caret**（textarea `caret-color: transparent`），在 `.nw-stack` 内渲染绝对定位元素 `.nw-cursor`（`aria-hidden`），宽 `var(--nw-caret-width, 2px)`、高 = 当前行高、背景 `var(--nw-caret-color)`、`border-radius:1px`、闪烁 `@keyframes nw-caret-blink`（1.06s steps，50% opacity 0）。
- 位置复用现有 `measureCaret()` 得到的行盒 top/left（同一套镜像测量），**不得**再引入第二套测量逻辑。
- 有选区 / 输入法组合中 / 失焦 时隐藏 `.nw-cursor`；打字机模式仍要工作（光标行居中不受影响）。
- `--nw-caret-color` 由各主题给出：claude/ink `#141413`、eye `#1f2a20`、night `#e8e6dc`、harness `#1f1f1f`。
- 另：`--nw-caret-width` 默认 **2px**（夜间主题可 2px 不变）。

## 5. 侧栏（shelf3）

新 props（lead 在 90-app 传入）：
- `onImport()` —— 左下「导入」大按钮（图标 + 文案，高度 ≥ 40px）。
- `onCollapse()` —— 收起创作台侧栏。
- `onExport(kind, id)` —— `kind` 为 `'novel' | 'chapter'`；在小说卡片 / 章节行的「⋯」菜单里提供「导出」项。
- `collapsed`（boolean，可选）—— 用于动画样式，缺省 `false`。

要求：
- 底部一排功能按钮（新建小说 / 新建章节 / 导入 / 回收站 / 设置）全部放大到 **≥40×40**，图标 18px，hover 抬升 + 过渡。
- 卡片/行新增「⋯」按钮（hover 才显），点开小型菜单（导出 / 重命名 / 删除），菜单要 `role="menu"`、`Escape` 关闭、点外部关闭；**菜单文本与 aria 用中文**。
- 章节行「⋯」里的「导出」调用 `onExport('chapter', chapter.id)`；小说卡片调 `onExport('novel', novel.id)`。
- 拖拽插入指示线、搜索、树形层级、aria 文案「新建子章节 / 重命名 / 删除」保持现状。
- 全部配色走 token；新增样式加动画过渡。

## 6. 编辑器上方横栏（lead 改 90-app）

最终只保留：`☰`（收起/展开创作台侧栏）、书名 › 章名、`⛶` 沉浸、`🔒` 锁定、`⚙` 设置。
被移走的：导入（去左侧栏）、导出（去书籍/章节「⋯」菜单）、AI 校对 / 一键排版 / 投稿（去右下悬浮坞）、备份 / 版本历史 / 主题 / 打字机（去设置）。

## 7. 右下悬浮坞（lead 改 90-app，class 名固定）

- 容器 `.nw-dock`（固定 `.nw-main` 右下，`right:20px; bottom:56px`，`z-index:40`）。
- 收起态：一枚 44px 圆形主按钮 `.nw-dock-fab`（图标 `✎`），带 `nw-pop` 动画。展开态：向上堆叠三枚 pill 按钮 `.nw-dock-btn`（AI 校对 / 一键排版 / 投稿），文案左图标右。
- **不得遮挡输入区**：写作面 `.nw-page` 右侧留白 ≥ 88px（theme3 在 `.nw-surface` 上给 `--nw-pad-x` 保证），且坞默认 `opacity:.35`、hover/focus 时 `1`；点击后自动收起。
- 移动端（`max-width:900px`）坞贴右下 12px。

## 8. 沉浸模式（lead 改 90-app，theme3 给样式）

- 进入：隐藏工具栏、目录、分隔条、状态栏，只留写作面；**不得**渲染任何顶栏。`Esc` 退出。
- 写作面背景用主题底色，页宽 `max(pageWidth, 880)`，上下留白加大。
- 顶部 32px 内为不可交互区（避免误触），鼠标移动到上边缘 24px 内可淡入一个 12px 半透明提示「Esc 退出」（可省略，若做必须 `pointer-events:none`）。

## 9. 设置面板（dialog3）

分区改为 6 段：
1. **外观** —— 主题（5 个按钮，含色块预览）、字体、字号、行距、页宽、打字机开关。
2. **写作** —— 自动保存间隔、默认导出格式、文末追加内容（多行 textarea）+「导出时追加」开关、导出是否含书名/作者、封面。
3. **导出与文件** —— 默认导出格式、导出附加项（页脚/署名/联系方式，即追加内容）、保存目录（原「保存目录」整段迁入）、镜像加密开关。
4. **隐私与锁定** —— 自动锁定、加密存储、改密码（当前密码/新密码/清除密码三个框）。
5. **投稿**（新）—— 邮箱账户（SMTP 主机 / 端口 / TLS / 用户名 / 密码 / 「测试连接」）、默认署名、默认联系方式、期刊清单入口（跳到投稿对话框的「期刊」页）。
6. **快捷键** —— 原样。

被收进设置的工具栏功能：备份（本地/云端，原 `backup` 对话框保留但从设置里进入）、版本历史（原 `versions` 对话框从设置/状态栏进入）、主题切换、打字机。

## 10. 导出（dialog3 + host3 + lead）

- 导出入口：小说卡片「⋯」→「导出全书」；章节行「⋯」→「导出本章」。`NW.dialogs.Export` 新增 props：`target`（`{kind, id, title}`）。
- 新增选项：`format`（docx/pdf/epub/txt）、`includeMeta`（书名作者）、`pageBreakPerChapter`、`includeToc`、`cover`（base64）、**`appendText`（文末追加固定内容）**、`appendOn`（开关）。
- **文末追加内容的落点**：`export.build` 的 `options.appendText`；Host 侧 `lib/docx.js` / `lib/epub.js` / `lib/routes.js`（txt 分支）在正文最后插入一个独立段落（docx 段落、epub 新 `<p>`、txt 末尾空行 + 文本）。`appendText` 超过 8000 字截断。
- 设置里保存默认：`exportSignature`（字符串）、`exportSignatureOn`（bool）、`exportFormat`。

## 11. 投稿（dialog3 + host3）

Host 新模块：
- `lib/journals.js`：内置期刊清单（≥14 家，字段 `{id,name,aliases[],genres{weixiaoshuo,duanpian,zhongpian,changpian},wordRange,requirements[],email,website,note,verified:false}`）+ `list()/merge(customEntries)`（用户自定义可覆盖内置项）。**内置 email 允许为空字符串**，UI 显示「待核对」徽章；用户可在「期刊管理」里填写并保存到 `DSH_HOME/novel-writer/settings.json` 的 `journals` 键。
- `lib/smtp.js`：纯 Node `net`/`tls` 实现 SMTP 客户端，导出 `send({host,port,secure,user,pass,from,to,subject,text,html,attachments,timeoutMs})`、`verify(config)`；支持 `AUTH LOGIN` / `AUTH PLAIN`、`STARTTLS`、multipart/mixed + base64 附件；错误一律结构化返回 `{ok:false,code,message}`，不抛。
- `lib/routes.js` 新增方法：
  - `journals.list` → `{journals:[…]}`（内置 + 用户覆盖合并）
  - `journals.save {entries:[{id,name,email,...}]}` → `{saved:n}`
  - `smtp.status` → `{configured,host,port,secure,user}`
  - `smtp.configure {host,port,secure,user,password}` → `{ok:true}`（密码进 secrets，键 `smtp`）
  - `smtp.test` → `{ok,detail}`（真连一次 + AUTH + QUIT）
  - `submit.prepare {journal, genre, work:{title,author,chapters:[{title,content}]}, profile:{penName,contact,email,signature}}` → `{subject, body, formatted:{chapters}, changes:[{kind,before,after}], warnings:[], wordCount, genre}`（用 `lib/ai.js` 的 `chatOnce` 让模型按期刊要求调整格式并写邮件；模型不可用时**必须**有纯规则兜底：去掉多余空行、统一全角标点、章节标题统一为「一、xxx」或原样、正文首行缩进两字、文末追加署名与联系方式，并返回 `warnings:['AI 不可用，已按内置规则排版']`）
  - `submit.send {to, subject, body, attachments:[{filename,mime,base64}], journalId}` → `{ok,messageId}`（SMTP 未配置返回 `{ok:false,code:'smtp-not-configured'}`）
  - `submit.record {}` → `{records:[{id,journalId,journalName,at,to,subject,status}]}`（写 `DSH_HOME/novel-writer/submissions.json`，最近 50 条）

Client（dialog3）`NW.dialogs.Submit`：
- 三段式：① 选期刊（可搜索列表 + 右侧显示该刊要求/邮箱/字数范围/体裁）② 选稿件（当前书 / 当前章 / 指定章节；体裁按字数自动推荐：<2000 微小说、2000–2万 短篇、2万–10万 中篇、>10万 长篇）+ 作者信息（笔名/邮箱/联系方式/署名）③ 预览邮件（subject 输入框 + body textarea 可编辑 + 格式调整变更列表 + 附件名 + 字数）→ 底部「确认投稿」。
- 未配置 SMTP 时第 ③ 步顶部给一条醒目提示 + 「去配置邮箱」按钮（跳设置·投稿页）。
- 投稿成功后 toast「投稿邮件已发送」并展示记录。
- 期刊管理：可编辑邮箱/要求，保存走 `journals.save`。

## 12. 本地加密方案（host3 + lead）

用户诉求：本地文件要加密。两层：
1. **IndexedDB 正文加密**（已有，`15-crypto.js`）——lead 在设置里默认推荐开启，并在未设密码时给一键入口。
2. **保存目录镜像加密（新增）**：`library.mirror` 增加 `encrypt:boolean`；为 `true` 时把每个 `<书名>.md` 改为 `<书名>.md.nwe`，内容是 `NWENC1` + `base64(iv[12] || tag[16] || ciphertext)`，AES-256-GCM，密钥由 `lib/secrets.js` 的 `key.bin` 派生（`HKDF-SHA256(key, 'novel-writer-mirror')`），并写 `library.json` 时同样加密为 `library.json.nwe`。
   - `library.get/set` 增加 `encrypt` 字段；`library.list` 返回 `encrypted:true` 与文件名。
   - 新增 `library.decryptTo {dir, outDir}`：把 `.nwe` 解密回普通 `.md` 供用户取用（写 `outDir`，缺省 `<dir>/plain`）。
   - 客户端「保存目录」区加开关「加密保存到该目录（.nwe）」+ 说明文案。

## 13. 阿里云盘简化（dialog3）

- 备份对话框默认 tab 改为 **本地备份**；云端再分「简单模式（推荐）」与「高级」。
- 简单模式只露三个东西：**WebDAV**（地址/用户名/密码 → 保存并连接，一键完成）与**「使用阿里云盘（扫码）」**大按钮。
- 阿里云 Client ID/Secret 收进「高级 · 自备应用」折叠区（默认收起），文案说明「普通用户无需填写；点扫码登录即可」。
- 任何失败都要在对话框内显示中文原因 + 下一步建议（如「请先在手机 App 确认授权」/「地址需以 http:// 或 https:// 开头」）。

## 14. 交付要求

- 每人回报：改了哪些文件、`node --check` 结果、对外接口变化（新增 props / 方法 / settings 键）、未做与风险。
- **不要**跑 `scripts/verify-*.mjs`、不要跑 `%TEMP%\nw-cdp\*`、不要跑截图脚本（用户明确说不要测试）。
- 不要执行 `node scripts/build-client.mjs`（lead 统一构建）。
