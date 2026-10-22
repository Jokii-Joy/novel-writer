# CONTRACT-R5 — 第五轮改造的契约

本文件是 R5 的唯一真源。凡与 `client/src`、`lib/` 里的实现冲突，以实现为准并同步回本文件。
R3 的 `docs/CONTRACT-R3.md` 仍然描述未变的部分（编辑器、docx/epub/pdf、打字机、加密模型），R5 只覆盖**下列 11 项**。

硬约束（用户原话）：**不开启子代理**；**改完不跑自动化测试，由用户自测**。本轮只做 `node --check` 与 `node scripts/build-client.mjs`。

---

## 1. 阿里云盘移除（原 ①）

- `lib/cloud.js` 重写为 **WebDAV-only**：导出面只剩 `status / config / login / poll / disconnect / list / upload / download / handle / probeCloud / parsePropfind / webdavUrl / TIMEOUT_MS / CloudError / ALIYUN_UNSUPPORTED_MESSAGE`。
- `resolveKind()` 只可能返回 `'webdav' | 'none'`。历史 `kind:'aliyun'` 的凭据不报错、静默降级为 `none`，由 `status().legacyAliyun` 上报，设置里提示「可将旧凭据清除」。
- `config({kind:'aliyun'})` → `{ok:false, error:{code:'aliyun-unsupported'}}`，message 见 `ALIYUN_UNSUPPORTED_MESSAGE`；`poll()` 恒返回 `cloud-no-poll`。
- `client/src/95-dialogs.js` 的备份面板删掉扫码按钮、Client ID/Secret 折叠区与授权等待框；云页只剩一片 WebDAV 表单 + 一句「阿里云盘已停止个人开发者接入」的说明。

## 2. 投稿邮箱服务器自愈（原 ②）

- `lib/smtp.js` 新增 `PRESETS`（QQ / 163 / 126 / Yeah / 新浪 / 阿里 / Gmail / Outlook / iCloud / 自定义，各带 `note` 说明授权码）、`hintFor(code, message, host)`、`diagnose(config)`。
- `diagnose()` 按 **(465 SSL) → (587 STARTTLS) → (25 明文)** 顺序重试，遇 `smtp-auth-failed` / `smtp-auth-unsupported` 立刻停（端口已通，换端口无用），返回 `{ok, code, message, attempts:[{variant, ok, code, detail}]}`。
- `verify()` 的失败 message 统一过 `hintFor()`，所以界面上不会只显示「连接已关闭」。
- `lib/routes.js`：`smtp.test` 改走 `diagnose`，回包带 `attempts`；新增 `smtp.presets`。
- 客户端设置·投稿顶部是预设胶囊（一键填主机 / 端口 / SSL），失败时把 `attempts` 拼成「已尝试 SSL 465✗ / STARTTLS 587✓」。

## 3. 设置改左右两栏（原 ③）

- `NW.dialogs.Settings` 由单列长滚动改为 **左导航 + 右内容** 两栏：`.nw-settings` = `grid-template-columns:150px minmax(0,1fr)`；右栏 `.nw-settings-pane` 是唯一滚动容器（`max-height:min(62vh,560px)`）。
- 六个分区顺序即 `SETTINGS_TABS` 顺序：外观 / 写作 / 导出与文件 / 隐私与锁定 / 投稿 / 快捷键。`section()` 按**调用序号**给 `data-tab`，并用 `data-on` 控制显示；未选中的分区仍挂载（异步加载器不会每次切页重跑）但不占高度。
- `<640px` 时降级为纵向：导航变成可换行的胶囊行。
- 从别处跳转（`openSibling(p,'settings',{section:'submit'})`）仍落到对应分区。

## 4. 主题从 5 套扩到 8 套（原 ④）

新增 3 套，`data-theme` 值即 id：

| id | 名称 | 纸面 | 墨色 | 强调 | 形态语言 |
| --- | --- | --- | --- | --- | --- |
| `card` | 极简卡片 | `#ffffff` | `#17181a` | `#3b6ea5` | 圆角 16/12、无描边靠阴影、Inter 无衬线 |
| `newspaper` | 报纸 | `#f2eee2` | `#1c1b17` | `#8c2b22` | 圆角 2/3、标题 small-caps、Georgia/宋体全衬线、2px 分隔线 |
| `guofeng` | 国风 | `#f5f1e6` | `#23211b` | `#a8442f` | 圆角 8/6、楷体正文、宋体界面、主按钮像朱砂印 |

- 三处必须同时改：`client/src/98-shell-theme.js`（重映射 13 个 `--dsw-alias-*` + `--dsw-specific-sidebar-fill` + `--nw-r-*` / 字体）、`client/src/60-editor.js`（`.nw-surface[data-theme=…]` 的正文纸墨，含 `--nw-ui-font-override` / `--nw-reading-font`）、`client/src/45-dialogs-css.js`（主题色板样片 `::before`）。
- `60-editor.js` 的 `THEMES` 白名单同步加入三值，否则 `themeOf()` 会把它们当非法值回退到 `claude`。
- 主题列表在 `95-dialogs.js` 的 `THEME_OPTIONS`（8 项），`07-locale.js` 补 `极简卡片 / 报纸 / 国风` 的英文。

## 5. 图标集（原 ⑤）

- 新文件 **`client/src/42-icons.js`**：`NW.icon(name, {size, weight, title, className, style})`，16×16 viewBox、`stroke:currentColor`、stroke 1.5、圆头圆角，路径全部落在 1.5…14.5 内。
- 名称表：`plus minus pencil trash child book doc save search filter caret chevleft chevright chevdown chevup home external gear more x check minusbox panel immersive lock unlock keyboard upload download refresh cloud folder proofread typeset typewriter send mail journal eye clock star sparkle info warn success moon sun list`。
- `50-shelf.js` 的局部 `ICON_PATHS` 保留为兜底，`icon()` 优先委托 `NW.icon`；侧栏、浮动坞、设置导航、欢迎页全部改用这一套，不再出现 `☰ ▢ ⛶ ⚙ 🔒 ✍ ¶ ✉ ×` 之类的文本字形。

## 6. 欢迎页与 `view`（原 ⑥⑦）

- `90-app.js` 新增 `const [view, setView] = useState('home')`，**默认首页**。`view === 'home'` 时主列渲染 `NW.Welcome`，编辑器只在 `view === 'write'` 时挂载。
- 切到写作的入口：选中章节（`selectChapter` 尾部 `setView('write')`）、新建小说首章、`onResume`、进入沉浸（`enterImmersive` 里 `setView('write')`）。
- 新文件 **`client/src/55-welcome.js`**：`NW.Welcome` 四张卡 —— 正在创作（按最近更新时间排序，最多 6 部，显示章节数 / 字数 / 日期）、创作统计（全书 / 本书 / 近 7 天 / 今天，由 `chapters[].updatedAt` + `wordCount` 聚合）、投稿记录（最多 5 条，状态徽章 + 距今天数）、快捷入口（继续写作 / 期刊库 / 投稿管理 / 设置）。
- 首页数据由 `refreshHomeFeed()` 在 boot 后拉取（`submit.record` + `journals.list`，两者失败都静默降级）；投稿成功后主动刷新一次。

## 7. 顶部工具栏删除（原 ⑦）

- `90-app.js` 删除 `Toolbar` 组件与 `chrome` 节点，DOM 里不再有 `.nw-toolbar`。
- 迁移去向：
  - **侧栏 topbar**：`首页 / 沉浸 / 宿主侧栏 / 锁定 / 设置 / 收起侧栏` 六个 24×24 图标（`.nw-shelf-topacts`，新增 props `onHome / onImmersive / onToggleHostSidebar / onLock`）。
  - **浮动坞「更多」组**（`.nw-dock` 内，分隔线 `.nw-dock-sep` 之后）：`创作台首页 / 隐藏目录|显示目录 / 沉浸模式 / 收起-展开宿主侧栏 / 设置 / 锁定`。
- 目录隐藏后侧栏头也不在了，所以坞里**必须有**「显示目录」，否则成单向门（这是本轮新增的一条硬约束）。

## 8. 投稿向导四步（原 ⑧）

- 步骤：`① 选期刊` → `② 稿件与格式` → `③ 邮件预览` → `④ 确认发送`（`initialStep` 允许 1–4）。
- 第 1 步顶部是**智能推荐**条（`.nw-reco`，最多 6 家，每项显示得分理由前两条，点一下即选中）。
- 第 3 步只编辑主题 / 正文 / 调整清单，**不发送**；第 4 步才显示收件人、附件、字数、体裁、SMTP 发件人、纸质刊警告与「确认投稿」。`doSend` 只在第 4 步可达。

## 9. 期刊库与智能推荐（原 ⑨⑩）

- `lib/journals.js`：内置由 16 家扩到 **79 家**，其中 **58 家**带公开收录的投稿邮箱。每条新增字段：`tags[] / subject（邮件主题模板）/ attachments（['docx','txt']）/ paperOnly / responseDays / minWords / maxWords`；全部 `verified:false`。
- `DEFAULT_SUBJECT = '投稿｜{genre}《{title}》｜{words}字｜{author}'`，`{…}` 由 `renderSubject()` 渲染。
- 纯函数 `scoreJournal(entry, work)` / `rank(list, work, limit)`：体裁命中 +40 / 不命中 −30，字数落在区间 +30，题材标签每条 +5（上限 20），有邮箱 +12，纸刊 −15，无邮箱 −6；每条加减都带一句中文 reason。
- Host 方法：`journals.recommend`、`submit.recommend`（同一个 handler）、`submit.update`。
- `submit.prepare` 现在额外返回 `attachments[]`（按期刊要求的 docx/txt，base64，DOCX 失败只进 warnings）、`subjectTemplate`、以及 `journal{id,name,email,website,paperOnly,responseDays,attachments,requirements,verified,note}`。
- `submit.send` 记录里新增 `title / genre / wordCount`，`submit.record` 额外算 `daysAgo`；`submit.update {id, status, note}` 原子重写 `submissions.json`，状态白名单 `sent|pending|accepted|rejected|published|withdrawn`。
- 两个新对话框（`90-app.js` 用 `openDialog('submitManager')` / `openDialog('journals')` 打开）：
  - `NW.dialogs.SubmitManager`（投稿管理）：状态筛选胶囊、每行小说名 / 期刊 / 日期 · N 天前 / 状态徽章 / 状态下拉 / 重新投稿（回填 `journalId` 重开向导）。
  - `NW.dialogs.Journals`（期刊库）：搜索 + 「只看待核对」、79 行列表带「已核对 / 待核对」徽章、行内编辑邮箱 / 官网 / 字数区间 / 要求（保存即写 delta，填了邮箱自动置 `verified:true`）。

## 10. 客户端 API 增量（`client/src/30-io.js`）

```
NW.io.journals.recommend(work, limit)
NW.io.submit.recommend === 同上
NW.io.submit.update({id, status?, note?})
NW.io.submit.smtpPresets()
NW.io.submit.send({…, title, genre, wordCount})
```

## 11. 文件归属（R5 变更）

| 文件 | 归属 | 说明 |
| --- | --- | --- |
| `client/src/42-icons.js` | 新建 | 共享 SVG 图标集，在任何用图标的 part 之前加载（按文件名排序 40→42→45→50） |
| `client/src/55-welcome.js` | 新建 | 首页（`NW.Welcome`） |
| `client/src/95-dialogs.js` | 改 | 设置两栏、投稿四步、投稿管理、期刊库、备份去阿里云、SMTP 预设 |
| `client/src/90-app.js` | 改 | 删 Toolbar、`view` 状态、坞「更多」、首页数据、Resubmit |
| `client/src/50-shelf.js` | 改 | 委托 `NW.icon`、topbar 六个动作 |
| `client/src/98-shell-theme.js` | 改 | 新增 card / newspaper / guofeng 三支 + 形态语言规则 |
| `client/src/60-editor.js` | 改 | `THEMES` 白名单、三套正文纸墨与字体 |
| `client/src/45-dialogs-css.js` | 改 | 设置两栏、推荐条、投稿管理、期刊库、色板样片 |
| `lib/journals.js` / `lib/routes.js` / `lib/cloud.js` / `lib/smtp.js` | 改 | 见 §1 §2 §8 §9 |

## 12. 构建与验收

- `node scripts/build-client.mjs` → `client/client.js`，当前 **19 parts / 606386 bytes**（SHA 见 §13）。
- 每个 part 与 `lib/*.js` 均过 `node --check`；`00-boot.js` 与 `99-end.js` 是刻意拆开的首尾半段，单独 `--check` 必然报错，属预期。
- **按用户要求本轮不跑自动化测试**。R2/R3 的 `scripts/verify-*.mjs` 与 CDP 套件保留在仓库里，但 R5 的选择器（工具栏删除、设置两栏）会让其中一部分失效，仅供历史参考。

## 13. 已知取舍

1. 首页的「今天 / 近 7 天」是按章节 `updatedAt` 的**近似**统计，不是逐日写作量流水；改一个旧章节也会把它的全文字数算进今天。
2. 79 家期刊的邮箱来自公开渠道汇总，全部 `verified:false`；`paperOnly:true`（收获）与无邮箱条目必须用户自己核对。
3. 推荐是纯规则打分，不理解题材语义；标签没命中时排序主要看体裁与字数。
4. 附件按期刊的 `attachments` 生成，DOCX 走与导出同一套 `lib/docx.js`；PDF 不在投稿附件里（多数刊物不收）。
5. 投递状态是本机记账，不解析回信。
6. 删除工具栏后，`05-css.js` 里 `.nw-toolbar` 的样式仍在（供别处复用），但插件自身不再渲染该节点。
