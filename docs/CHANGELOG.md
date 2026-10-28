# 精神空间 · 开发日志与详细文档

> 本文件是从 README 拆出来的完整版：逐轮改造记录、验收数字、架构树、已知限制、
> GitHub 自动上传配置，都在这里。面向使用者的简要说明见仓库根目录的 [README.md](../README.md)。

一个 DSH 双半插件（Host + Client）。左侧栏点书本图标进入 **中央面板**（不是右侧抽屉），
左目录 / 右编辑区的沉浸式布局，数据全部留在本机 IndexedDB。

- 包名：`@local/novel-writer` ｜ 版本：1.2.0 ｜ 入口：`index.js`（Host）+ `client/client.js`（浏览器）
- 依赖：**零运行时第三方依赖**（Host 只用 Node 内置模块，Client 只用宿主提供的 `react` 与主题 token）
- 第四十七轮（R47）改造：**沉浸时右下角的按钮还在，稿子上能画标注**。
  两件事一起做，因为它们是同一个问题的两半：写的时候不想看见工具，但读完一遍想记点什么时
  又有地方可记。
  ① **沉浸模式不再把右下角的写作工具整个拿掉**。原来 `90-app.js` 里是
  `const dock = immersive ? null : h(Dock, …)`——不是 CSS 藏起来，是根本没渲染，于是全屏写作时
  校对/排版/建议/读一遍/投稿五个入口一个都不在。改为始终渲染，只用
  `.nw-dock[data-immersive="1"]{bottom:20px;right:16px;opacity:.3;}` 把它收小、变淡，
  hover 或展开菜单时恢复不透明：要它时在，不要它时不碍眼。
  ② **「读一遍」里可以选中一段字画标注**：下划线、删除线、待改（虚线）、批注（带正文的批注
  另外弹一层小窗写内容）。选中后浮出四个按钮的小工具条；点已有标注可以看批注正文、改它或删掉。
  标注是**按字符区间**存的（`start`/`end`，另存一段 `quote` 便于人读），不是按页、按行——
  换字号、改栏宽、改窗口大小都不影响。
  ③ **编辑时也看得见**。编辑器本来就有一层透明的高亮镜像（`.nw-hl`，在透明 textarea 背后画
  底色，供查找命中和修改建议用），标注直接复用这一层，加了 `.nw-mark-underline` /
  `.nw-mark-strike` / `.nw-mark-todo` / `.nw-mark-comment` 四种画法：下划线是 `inset` 阴影、
  删除线是 `text-decoration`、待改是 8px 一格的虚线、批注是淡色底加一条细线和一个角标点。
  **文字本身一个像素都不动**，所以标注永远不会改变原文，也不会改变分页。
  ④ **标注跟着字走，不跟着位置走**。写作时在中间插一段，后面所有标注的偏移都会错位；所以
  保存时（`commitSave`，覆盖打字、粘贴、替换、IME 提交所有路径）用现成的 `diffEnds()` 算出
  这次编辑的形状 `{head, oldMid, newMid}`，交给 `shiftMarksForEdit()` 把本章所有标注平移：
  落在编辑点之前的原样不动，之后的整体平移，跨过编辑点的取交集、被删没了就丢掉。每保存一次
  只做一次 diff，不是每次按键。手机那边改的字同步过来时走的是另一条路（`adoptExternalText`
  故意不标脏、不触发保存），所以那里也补了同一次平移——否则一路同步下来，全书的下划线都会
  慢慢挪到别的字底下。
  ⑤ **落在 `marks` 这个新 store 里**（`DB_VERSION` 2 → 3，`byChapterId`/`byNovelId` 两个索引），
  随 `dump()`/`replaceAll()` 一起进备份，也随回收站走：删章节或删书时，这一章的标注一起进
  `trash` 的 `payload.marks`，撤销时跟着文字一起回来；从手机同步过来的墓碑把书删掉时同理。
  刻意没有塞进 `notes`：灵感便签是「一章一条」的整体文本，标注是「一段文字上的若干条」，
  混在一起两者都难受。
  `client.js` 重建为 21 段 **981281 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
  手机端是独立原生 App，不受影响。
- 第四十六轮（R46）改造：**沉浸写作时只照亮正在写的那几行**。
  全屏写作最想要的效果是「眼前只剩这一段」，但正文是一个 `textarea`，一个元素里的字只有
  一个 `color`——没法只把一部分行调浅。所以用两块「纱」（`client/src/60-editor.js`）：
  `.nw-veil-top` 从顶部铺到光标行上方 `focusLines` 行，`.nw-veil-bot` 从光标行下方铺到底，
  中间留一条不遮的带。纱的颜色是 `color-mix(in srgb, var(--nw-bg) 72%, transparent)`，
  跟着主题走（夜间主题就淡向深色墨，而不是把字洗白）。
  ① **边界落在行盒上，不落在字腰上**。纱用 `linear-gradient` 在最后 `--nw-focus-feather`
  （正好一行高，`calc(var(--nw-size) * var(--nw-line))`）内渐隐，所以淡化是从一整行的边线
  开始散开的，不会把正在写的行的字切掉一半。
  ② **滚动不测字**。纱是 `.nw-surface` 的子节点（不滚动），高度是视口像素；每次测量已经拿到
  光标行的**内容坐标** top（`measureCaret().top` 本来就是那个坐标系），于是滚动时只需要
  `content_top - scrollTop` 就能重画，不用再测镜像、不触发 reflow。滚动事件用 rAF 合并
  （`repaintFocusSoon`），触控板一甩几十次事件也只画一帧。
  ③ **只在沉浸模式亮**（`focusOn = immersive && settings.focusDim !== false`）。分层位置是
  `z-index:1`：在透明 textarea（`base`）之上、厚光标（`float`）之下——光标永远不会被纱盖住。
  ④ **可以关，也可以调宽**。设置 → 外观新增「沉浸时只照亮正在写的几行」开关与
  「上下各留 N 行」滑杆（0–8，默认 2），存进 `DEFAULT_SETTINGS` 的 `focusDim`/`focusLines`。
  手机端是独立原生 App，不受影响。
  ⑤ **两种滚动容器分开算**。`.nw-scroll` 自己滚时（正常宿主）纱是视口矩形，要夹在面板高度内；
  宿主槽位高度为 auto、改由祖先或文档滚动时，`.nw-surface` 本身跟着稿纸走，纱是内容坐标，
  这时不夹面板高度（否则整条带会缩到顶部），让滚动容器去裁。
  `client.js` 重建为 21 段 **942924 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
- 第四十五轮（R45）改造：**手机改过的字，电脑跟着看那个字**。
  手机在局域网里改一段、电脑端自动同步之后，光标会跳到全章最后一行——作者本来在读第三段，
  一抬头人在文末。原因不在同步本身，在「把新文字塞进编辑器」这一步：接内容的 effect 用
  `setEditorText(incomingContent, len, len)`，选区被显式设到**文本末尾**；而 `setEditorText`
  内部又照常 `scheduleMeasure(true)`，`refresh(true)` 用打字机的 center 模式把那一行拖到视口正中。
  两处叠加：光标去了末尾，视口紧随其后——于是「跳到最后一行」。它原来还对**后台来的**文字做了
  两件不该做的事：标脏（状态栏显示「未保存」，并排一次写回，可能把同一段文字在两端来回倒）
  和重排居中。
  ① **新增 `adoptExternalText(next)`**（`client/src/60-editor.js`）。它只负责「换成对端的文字」，
  不标脏、不居中：先 `cancelSave()`（排队中的保存会把对端改动覆盖掉），写 `valueRef`，
  把 `lastSavedRef` 记成这段文字（**对端已存过盘，回声不算编辑**），然后清 `pendingCenterRef`，
  避免先前排队的居中请求在这次之后又放一枪。
  ② **光标跟着字走，不是跟着末尾走**（`diffEnds` + `shiftOffsetForEdit`）。先算两个版本的
  公共前缀 `head` 与公共后缀 `tail`，得到被替换的中间段；光标在原编辑点之前就原地不动，
  在之后就整体平移 `newMid - oldMid`，落在被替换区域里面则收在改动末尾。这样「手机在第 5 段
  改了三个字」不会把电脑上的光标从第 3 段赶走。整章两万字只扫一遍，`charCodeAt` 直接比。
  ③ **视口只在必要时动**（`revealPeerEdit`）。先问 `caretScrollTop('nearest')`：光标那一行
  真的出了屏幕就跟过去；还在屏幕上就什么都不做。**「同步修改的位置」这个要求的另一半**是
  让作者看见手机改了什么，所以还要判一次：最近 `PEER_FOLLOW_IDLE_MS`（3 秒）内本窗格有没有
  在打字（`typedAtRef`，`afterEdit`/`handleInput` 各盖一次时间戳，切章重置）。刚打完字就
  不抢视口——正在写的人不该被移动；停下来了才把改动那一段露出来（`measureCaret(d.head)`
  定位到改动起点，落在视口外才滚，且滚到上方 1/4 处留出上下文）。
  用「最近是否打字」而不是 `activeElement`，是因为点「读一遍」、点工具栏都会让焦点离开
  textarea，那些点击没有一个是「把光标交给手机」的意思。
  ④ **不再主动居中**。`adoptExternalText` 末尾走 `scheduleMeasure(false)`；`revealPeerEdit`
  调整过视口时还会把 `pendingCenterRef.current` 清掉——否则紧随其后的居中会把视口拽回去，
  等于白滚。
  `client.js` 重建为 21 段 **933412 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项全过。
- 第四十四轮（R44）改造：**「读一遍」——把稿子当书看**。
  写的时候人是贴着字看的，眼里全是句子：这一句是不是太长、那个词重复了没有。
  要判断「这是一篇小说吗」，得把距离拉开——一次性看到整篇的呼吸。原先这件事只能靠
  导出去、用别的软件打开，或者把窗口拖到半屏假装在看书。
  ① **新增阅读视图**（新文件 `client/src/62-read.js`）。写作工具圆盘的菜单里多了
  「读一遍」：整本书铺成一页一页的纸，没有光标、没有工具栏、没有章节树，也没有保存
  指示灯——一本书不该有这些东西。右上角只有书名和一个关闭按钮，底部左下是淡出的翻页
  提示、右下是「第几页 / 共几页」。
  ② **分页不预设**。用的是 CSS 多栏（`column-width` + `column-fill:auto`）在固定高度的
  容器里横向溢出，翻页只改 `scrollLeft`，**没有把正文预先切成「页」**——所以窗口一改宽度、
  字号一放大，版面自然重排，页码也重算。一处也没有新增依赖。栏宽取
  `min(34 字宽, 可用宽度)`：一行三十四个汉字上下最像书，但不会越过面板。
  每章另起一栏（`.nw-read-chapter + .nw-read-chapter{break-before:column}`），
  章节标题居中、下面一条细线，与写作台的 `.nw-chaptertitle` 同一套观感。
  占位标题（「新章节」「未命名」「第一章」这类）不进书页，否则每章顶上都会白挂一行。
  原文里的空行也不当成废行抹掉：中文长篇里空行往往就是「换场」的唯一标记，压平之后
  整章会塌成一片段落墙，所以空行转成下一段上方的额外一段空气（`data-gap`），
  行首的手工全角缩进则统一收走，改由 `text-indent` 给——不然排版过的稿子会缩进两次。
  ③ **字号、行高、主题全部沿用写作设置**。阅读视图挂 `nw-surface` 与 `data-theme`，
  拿到的是同一批主题 token，所以夜间模式读出来还是夜间、报纸主题还是报纸；
  `fontSize`/`lineHeight` 直接取当前设置，行宽与写作时一致。不是另做一套版面。
  ④ **退出时回到原来的句子**。这是个覆盖层，不是路由——编辑器从头到尾没被卸载，
  所以光标位置、滚动位置、连还没自动保存的那个字都还在。关闭时把焦点还给 textarea
  （`editorRef.current.focus()`），落点就是离开时那一句。
  ⑤ **Esc 归它管**。沉浸模式的 Esc 是在 window 捕获阶段单独注册的，且不参与
  `40-ui` 的 `escapeStack`，如果不管它，在沉浸模式下按 Esc 会先把全屏退掉、书页却还在。
  所以沉浸那个 effect 的依赖里加上了 `readOpen` 并在开头 `if (readOpen) return`——
  一次 Esc 只收一层。
  ⑥ **翻页的四种方式**：方向键 ←→↑↓、PageUp/PageDown、空格（向前）、Home/End（首尾）；
  点右半页翻下一页、点左半页翻上一页（位移超过 8px 或有选字就不算点，免得选段时乱翻）；
  手机横拖、触控板横滑跟手（滚动停下 170ms 后对齐到整页）；竖向滚轮也翻页——横向滚动
  容器对竖向滚轮本来没反应，而看书的人不会先想一想该往哪边滚。
  打开时直接定位到「当前正在写的那一章」所在的那一页，用的是章节元素
  （`marksRef`）落进第几栏算出来的，不是靠字数估算；那一跳会临时关掉
  `scroll-behavior`，否则书会从第一页一路滑过去，像自己翻了好几页。
  ⑦ **当前这一章读的是编辑器里的实时文本**，不是库里的行：自动保存有延时，
  用落库内容会把最后几个字漏掉。`getEditorText()` 取的就是 textarea 里的现值。
  ⑧ **翻页不重拆全书**。整本书拆段是这里唯一的重活（二十万字要走两万行），而翻页只改
  页码、提示五秒后只改一个 flag，两者都会重渲染——所以正文用 `useMemo` 缓存在
  `chapters/currentId/currentText` 上，App 侧也把 `chapters.filter(…)` 提成
  `readChapters` 的 memo，否则每次键盘输入都会生成新数组、缓存永远失效。
  `client.js` 重建为 21 段 **926029 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项全过。
- 第四十三轮（R43）改造：**中英混排、全屏没有键、便签压正文、手机改的到不了电脑、手机上打不出引号** ——
  五件事各修各的，其中两件是真的 bug：
  ① **界面中英混排 → 全中文**。`07-locale.js` 里一直挂着一张 331 条的 `EN` 表（中文键 → 英文值），
  注册给宿主 locale 时 `DICT` 是 `{ zh: {}, en: EN }`：宿主按 fallback 链查 key，`zh` 字典是空的、
  `lookup` 只认 `value !== undefined`，于是命中的永远是 `en` 那一侧 —— 有英文行的文案变英文、
  没有的回落成 key 本身（中文），这就是「一会儿中文一会儿英文」的确切成因，跟浏览器语言无关。
  现在 `EN` 整张表删掉，`DICT` 变成 `{ zh: {}, en: {} }`：两个空字典意味着链上从不命中，
  `translate` 一律返回 key，而 key 本来就是中文。`locale/en.json` 的 `meta.title/description/nav`
  同步改成中文，免得宿主语言切到 en 时插件名又变回 Mindspace。`NW.t` 的 `{0}` 占位替换、
  `NW.bindLocale` 全部保留，`07-locale.js` 从 423 行缩到 77 行；`bindLocale` 顺手给
  `locale.register` 包了一层 try/catch —— 同一命名空间重复注册在宿主热重载时会抛错，而空字典
  本来就不影响结果，不该因此把整个面板带崩。
  ② **全屏加一个简单快捷键**。沉浸模式原先只能点工具栏、退出只能按 Esc，没有任何键盘入口。
  新增一个 capture 阶段的监听：`F11`（不带修饰键）或 `Ctrl/Cmd+Shift+F` → `toggleImmersive()`，
  与已有的 `Ctrl+Shift+L`（锁屏）、`Ctrl+\`（书架）并列。两种写法是有意的：F11 是浏览器保留键，
  页面 `preventDefault` 无效，只有在宿主先吞掉按键时才到得了这里；`Ctrl/Cmd+Shift+F` 是保证送达的那一个。
  **离开不要求当前有打开的章节**，否则没开章节时会卡在一个没有工具栏的房间里出不来。
  进入沉浸的提示同步改成「已进入沉浸模式 · Esc 或 Ctrl+Shift+F 退出」，设置页与「快捷键」面板
  也各补了一行，不然这个键只有进过一次沉浸的人才知道。
  ③ **全屏时灵感便签压进正文**。便签的宽度是「居中页两侧空白的一半减 22px」
  （`.nw-notes{width:clamp(0px, calc((100% - min(var(--nw-page,760px),100%)) / 2 - 22px), 340px)}`），
  而 `--nw-page` 一直写的是用户设置（默认 760）。但编辑器在沉浸时会把自己的页宽抬到
  `Math.max(pageWidth, 880)`（`60-editor.js:640`）——设置里写的 760 与屏幕上的 880 对不上，
  算出来的「空白」比真实空白大，卡片就长进了正文。现在写作台的 `--nw-page` 用**同一个公式**算
  （`Math.max(clampNum(pageWidth,360,1400), immersive ? 880 : 0)`），并给 `.nw-bench` 加了
  `data-immersive` 钩子备用。窄容器下本来就有 `@container nw (max-width:560px)` 的宽度释放，
  不需要再加分支。
  ④ **手机上改的同步不到电脑**。两条独立的成因：其一，`pullSync` 闭包捕获了 `novels`，
  而每敲一个字 `saveChapter` 都会 `setNovels` → `useCallback` 换引用 → 轮询 effect 重建 →
  **6 秒计时被无限重置**，用户一直打字就一直不拉取；改成 `novelsRef.current`，依赖数组收窄到
  `[refreshNovels, refreshChapters, adoptRemoteChapter]`。其二，`applyBooks` 只写 IndexedDB，
  而当前打开的那一章活在 React state 的 `chapter` 里，`60-editor.js` 的 `incomingContent` effect
  只在 `chapter.content` 变化时才灌进 textarea —— 手机改的正好是「你正开着的那一章」时，
  改动落了库但界面纹丝不动。新增 `adoptRemoteChapter(books)`：`applyBooks` 之后按
  `chapterRef.current.novelId` 找回刚同步的书，`NW.db.getChapter` 重读并解密，与编辑器当前文本
  不同才 `setChapter(record)`。四道守卫避免吞掉用户输入：没有打开章节、书是墓碑、
  `saveState` 处于 `dirty`/`saving`、内容相同（相等就不 set，光标不跳）。
  ⑤ **手机打字加常用符号条**。`EditActivity` 的写作页在正文下方新增一条可横滑的符号条
  （`symbolBar()`）：`⇥`（插入两个全角空格，与桌面 `60-editor.js:45` 的 `TAB_TEXT` 完全一致）、
  成对引号 `“” ‘ ’ 《》（）`、顿号/逗号/句号、破折号、省略号、问号叹号冒号分号。
  点击走 `insertAtCaret()` → `editable.replace(start, end, text)`，**替换选区并留住输入法的撤销栈**，
  再把光标移到插入之后；因为走的是 `Editable`，`TextWatcher` 照常触发 1.2 秒自动保存与
  `SyncEngine.pushSoon`，不需要额外的保存路径。按钮复用 `nw_bar/nw_ink` 主题 token，
  夜间皮肤自动跟随。
  `client.js` 重建为 20 段 **903544 字节**（比 R42 少 7672 字节，删掉的那张英文表就在里面），
  `verify-client-load` 报 `inject=["slots","layout","locale"]`；`dist/精神空间.apk` 重新打包
  （`553769` 字节，符号条随包出去，签名同上一版）。
- 第四十二轮（R42）改造：**手机连电脑要按好几次、投稿记录那条名字没变** —— 前一个不是网络问题，
  后一个不是渲染问题，两边的根因都在「谁该带什么信息」上：
  ① **局域网同步「有时候链接不上、有时候试很多次才行」**。桌面端发现层原先只会**广播**：
  `startDiscovery` 把信标按 30 秒的节奏发出去，`receive` 侧却是一个 2.5 秒的窗口，
  手机点「立即同步」时能不能撞上完全看运气（约 1/12 命中），于是「按几次才连得上」。
  现在同一个 socket 上多了一条**探针应答**：手机广播 `{protocol, role:'probe'}`，桌面收到立刻
  **单播**回一个信标（`beaconMessage(announcePort, identity)`），等待从「等下一次 tick」变成一次
  往返；同时广播周期从 30 秒降到 10 秒，`broadcastTargets()` 每次发送时重算（换了 Wi-Fi、
  网卡后起也能打到对的子网），并真正 `bind({port, address:'0.0.0.0', exclusive:false})`
  来收探针；`startDiscovery` 重复调用不再早退，而是用新的 `announcePort` 刷新——端口重启后
  信标里带着旧端口，正是「找到了却连不上」的成因之一。`discoveryStatus()` 多返回 `listening`。
  ② 手机侧四处配合：`LanClient` 增加 `ping()`（`GET /nw/v1/ping`，4 秒超时），
  `SyncEngine.locate()` 用 ping 取代原来的「拉整个书库当探针」——慢网下后者会超时，
  让一台正在应答的电脑看起来「不在」；`SyncEngine.sync()` 加了进程级 `synchronized (LOCK)`，
  手动同步与 45 秒后台 tick 不再抢同一个 UDP socket；握手/同步请求显式带 `connection: close`
  （桌面 `keepAliveTimeout` 是 5 秒，而 `HttpURLConnection` 会缓存更久，复用一条已被对端关掉的
  连接会抛 `unexpected end of stream`，被当成「不可达」）；`Discovery.listen` 改成绑定临时端口
  + `setReuseAddress`（原先绑 41287，两次并发查找直接 `BindingException` 报「找不到电脑」），
  并一边探测一边听（每 700ms 一轮）、同时发有限广播与各网卡定向广播。新增 `Multicast.java`
  在查找期间持有 `WifiManager.MulticastLock`（仅几秒，不常驻），manifest 补
  `CHANGE_WIFI_MULTICAST_STATE` —— 省电策略会在息屏后过滤广播包，这正是「有时行有时怎么点都不行」
  的真身。
  ③ **投稿记录唯一那条仍显示旧名**。R41-fix 让 `handleSubmitSend` 落 `novelId`，但客户端的
  `NW.io.submitSend` 是个**白名单**，只透传 `to/subject/body/attachments/journalId/title/genre/wordCount`，
  向导明明传了 `novelId`，在这一层被静默丢掉，于是记录里永远没有 id、渲染层只能回落到标题快照。
  `30-io.js` 白名单补上 `novelId`；`submitUpdate` 改为按**属性是否存在**判断（空串 = 主动解除关联）；
  `handleSubmitUpdate` 接受 `novelId`。历史记录已经丢了 id，且**无法自动恢复**：标题不唯一、
  改名不留痕、`sync-state.json` 里三本旧的《暴雨附身》都是墓碑，只有靠作者说一句话——
  所以投稿管理里对「没有 id / id 已失效」的行多一个「关联稿件…」下拉，选完即写回并刷新。
  「重新投稿」也带上原记录的书 id，不再落到书架第一本。
  `verify-host.mjs` 新增 [5b] 15 项（读回两条 / 老记录仍无 id / 新记录 id 原样返回 / 可补 id /
  补 id 落盘 / 补 id 不动标题快照 / 不动状态 / 记了 updatedAt / 只改状态时 id 保留 / 空串解除关联 /
  拒绝未知状态 / 拒绝未知记录 / 被拒的写入没改文件），共 **219 项 0 失败**；`client.js` 重建为
  20 段 911216 字节；`dist/精神空间.apk` 重新打包（`classes.dex` 530204 字节，签名同上一版）。
- 第四十一轮（R41）改造：**在稿纸上直接改章节名，首页告诉你正在写哪一章** —— ① 编辑器顶部的
  章节标题从「只读的展示文字」变成可点击编辑的 `contenteditable="plaintext-only"`：点一下就能改，
  Enter 提交并失焦、Esc 放弃还原、粘贴与拖入强制转纯文本、超过 120 字截断、空白一律视为误点不落库
  （否则 `updateChapter` 会把空标题写死成「未命名章节」）。提交走 app 侧新增的
  `renameChapterTitle(id, next)`：先 `patchChapterInList` + `setChapter` 让侧栏和正文顶栏立刻同步，
  再 `NW.db.updateChapter` 落库，并用返回的最终标题回写一次（`未命名章节` 这类兜底能正确回显）；
  **故意不走 `refreshChapters()`**，那会把整本书的正文重读一遍。② 标题元素改成**常驻挂载且 children
  为空**，文本由 ref 回调里写：保存状态一变整个写作台都会重渲，若把标题当作 React children，重渲
  会把输入中的文字重置回库里的旧标题、光标弹回行首。编辑中靠 `data-editing` 守卫跳过同步。同时原来
  「占位标题不显示」的规则（R17）被推翻 —— 自动创建的章节标题是「新章节」，按老规则编辑器里根本不
  渲染标题，用户在新章节里连入口都没有；现在始终渲染，占位时用 `data-empty` 变淡并显示「章节标题」
  占位提示。③ 首页「正在创作」每部书多一行 **正在写 <章节名>**：章号来自 `nw.lastChapterByNovel`
  里该书上次停留的章节，没有记录就取该书 `updatedAt` 最新的那一章；整行点击直达那一章
  （app 侧 `onResumeChapter` 对「点的正是当前章」单独处理，否则 `selectChapter` 开头的同 id 守卫会让
  点击变成哑炮）。④ 沉浸模式下按 Esc 原本会被宿主的 window 捕获监听直接吃掉退出沉浸，现在该监听
  在 capture 阶段就跳过 `.nw-chaptertitle` 里的按键，标题编辑里的 Esc 只还原标题。
  ⑤ 英文文案补 `章节标题 / 重命名失败 / 正在写` 三条；`verify-host.mjs` 188 项、`verify-docs.mjs` 44 项
  全过，`client.js` 重新构建为 20 段 904797 字节，`verify-client-load` 报
  `inject=["slots","layout","locale"]`。
- 第四十一轮修补（R41-fix）：**改标题变成一串字符、保存目录越攒越多、投稿记录不改名** ——
  三个都是 R41 上线后立刻暴露的，各自根因不同：
  ① **标题里出现一串 id**。编辑器调用 `onRenameTitle(chapterId, next)` 时传两个参数，而 app 侧
  接的是 `(next) => renameChapterTitle(chapter.id, next)`——于是章节 id 被当成标题落了库。
  改成 `(id, next) => renameChapterTitle(id != null ? id : chapter.id, next)`，两边的参数个数从此
  一起看、一起改。附带补了 IME 守卫：`handleTitleKeyDown` 开头 `if (ev.isComposing || composingRef.current) return;`，
  否则中文输入法敲 Enter 选词会被当成「提交」，把未上屏的候选词连同半个拼音写进标题——
  用户看到的「一串字符」两种成因都占。
  ② **保存目录里留下一堆旧文件**。`mirrorLibrary` 一直是「只增不减」：书名一改，`旧名.docx` 留着，
  `新名.docx` 再写一份。现在新增 `plannedNames(novels)`——把 `uniqueStem` + `safeTitle` 的重名规则
  原样重放一遍，得到「这份清单会写出哪些文件名」；配合 `previousSnapshot(target)` 读回上一次
  `library.json` / `library.json.nwe` 里的书名（加密时先 `deriveMirrorKey()` 解出来），两边一比对，
  差集就是改名/删书留下的孤儿，写完全部新文件之后才逐个 `unlink`（删除失败不致命）。
  只碰快照能推导出来的名字，用户自己放进目录的 `我的笔记.txt` 永远不动；比较走 `toLowerCase()`，
  符合 Windows 的大小写语义。同一套重放也顺手补上了 正文加密 的开关：`plannedNames(novels, encrypt)`
  只列出当前格式会写的名字，旧快照的格式由 `previousSnapshot` 的 `encrypted` 标志带回来，于是
  打开加密时 `.docx` 与 `library.json` 被清掉、关掉加密时 `.docx.nwe` 与 `library.json.nwe` 被清掉，
  同一本书永远只有一份。
  ③ **投稿记录还显示旧书名**。记录里的 `title` 是发送时的快照（编辑收到的是那个名字，事后改写就是
  伪造记录），所以不动它，而是让记录带上 `novelId`：`handleSubmitSend` 落 `novelId`，
  `submit.send` 从向导传上去，投稿管理与首页投稿卡片都用 `p.novels` 把 id 解析成现名；两边不一致时
  显示「现名（投稿时：旧名）」，一致时只显示现名，老记录没有 id 就回落到快照。
  `verify-host.mjs` 新增 16 项镜像用例（改名后只剩一份、旧名与同名副本都被删、`library.json` 与
  无关文件不动、改回原名也能覆盖、加密开/关各清掉另一格式的双胞胎），共 **204 项 0 失败**；`verify-docs.mjs` 44 项 0 失败；
  `client.js` 重建为 20 段 907435 字节。
- 第四十轮（R40）改造：**两个「点了没反应」的按钮，和书名重复出现** —— ① 书架标题栏的
  「收起/展开宿主侧栏」按钮此前完全无效：宿主把 `layout` 服务放在它自己的客户端插件里
  `ctx.reflect.provide("layout", …)`，而插件的 apply 顺序不由我们决定，`ctx.get('layout')` 又只
  在提供方 fiber 处于 ACTIVE 时才作答 —— 我们在 apply 里读了一次就把 `null` 永久缓存下来，之后
  每次点击都静默 return（没有报错、没有提示，看上去就像按钮坏了）。现在改成 `NW.layoutService()`
  每次现取（先 `ctx.get`，取不到才回退旧句柄），应用启动时也补上了 `inject: ['layout']`，让宿主
  在服务就绪后重跑一次 apply（顺带也声明了 `locale`，标签文案同样依赖它）；仍然取不到或抛错时
  改为弹一条 toast，不再假装没事发生。顺带修了
  「自动收起宿主侧栏」的会话门闩：旧代码先写 `sessionStorage` 再判断 layout 在不在，一旦那次启动
  没拿到服务，这一整轮会话就再也不会自动收起了。② 编辑区左上角的「回到首页」在**沉浸模式下**
  点了没反应：首页的渲染分支是 `!immersive && view === 'home'`，沉浸时它被短路，点了只改了一个
  没人看得见的 state。现在先 `exitImmersive()`（同时退出全屏）再跳首页，并顺带展开书架。
  ③ 导出与投稿时，**章节名和书名相同时不再重复出现**：`lib/routes.js` 新增
  `comparableTitle()` / `duplicatesBookTitle()` / `stripDuplicateTitles()`，比较时忽略《》「」『』
  这类包裹符号、空白与大小写，但**只比较整条标题**——「第一章 秋水」是作者真写的章号，原样保留；
  导出链在占位标题清理之后统一过一遍（txt / docx / pdf / epub 四个分支、以及投稿附件都走同一份
  `novel.chapters`），投稿链在 `formatWork()` 拼「一、」编号**之前**判断，并在 AI 回填标题
  （`adoptModelChapters`）之后再过一遍，所以邮件正文、正文粘贴块、docx 附件三处同时生效。
  epub 的重复是以**目录标签**体现的：首章标题置空后 `buildEpub` 回退成「第1章」，正文页也就不再
  输出第二个 `<h1>`（单章书仍回退成书名，这是既有设计）。④ `scripts/verify-host.mjs` 新增 [5] 段
  14 项断言（txt 三种标题形态、docx、epub 目录与首章页、投稿预排版、邮件正文、编号保留、附件），
  **188 项全过**。⑤ 顺带修掉一个**只在这台机器上才复现的上传故障**：本机 DNS 把 `github.com`
  解析到 `20.205.243.166`，该边缘的 443 端口是黑洞（`curl` 返回 000、`git push` 卡 21 秒后
  `Failed to connect`），而 `api.github.com` 与美区边缘同时可用，于是 R40 的提交在本地成功、
  自动上传连续 8 次全灭。`tools/auto-push.mjs` 现在先按 3 秒超时探活候选地址（上次成功的缓存 →
  系统 DNS → 四个已知可用边缘），**第一次仍走域名**，之后每次重试换一个探活通过的地址并用
  `git -c http.curloptResolve=github.com:443:IP` 钉住，成功后写进 `.tools/github-ip` 下次优先。
  不改系统 hosts（要管理员权限，且会把一次性 DNS 故障变成永久配置）。

- 第三十九轮（R39）改造：**手机端长章不再卡，并把仓库正式放到 GitHub（GPL-3.0）** —— ① 编辑器的正文
  从「自己滚动的 EditText」改成「外层 ScrollView + 不滚动的 EditText」：拖动时只平移，不再让 EditText
  每次移动都重排文本；光标跟随改由 `keepCaretVisible()` 手工做（120ms 节流、只在离开中间带时滚），
  同时关掉水平滚动与过度滚动。② 保存不再占主线程：`Store.updateInBackground()` 把「解析整库 → 改一章
  → 序列化」放到单线程队列，1.2s 防抖落盘与返回书架都走它，主线程只收结果。③ 章列表的字数改用
  `Library.words()`，不再为每一行 `replaceAll("\\s","")` 复制整章。④ 仓库有了正式 README、GPL-3.0
  许可证、`tools/auto-push.mjs` + `.githooks/post-commit`（每次提交自动上传，失败重试并记日志），
  旧的完整文档移到 `docs/CHANGELOG.md`。
- 第三十八轮（R38）改造：**让手机端真的能上手用，并把同步状态说清楚** —— ① 桌面「设置 → 手机同步」
  里的「同步状态」一直写「还没有同步过」：桌面只在自己推送时记时间，手机推上来的那次没人记。现在
  `lib/lansync.js` 新增 `markPeerSync()` / `peerSyncSummary()`，LAN 同步端点与 `peer.apply` 都会落一笔，
  `sync.pull` 顺带返回它，面板显示「最近一次同步 …」。② 配对面板不再弹新窗口：原来的 `NW.dialogs.Pair`
  拆出 `PairPanel` 组件，直接内联在设置分区里（地址、配对码、倒计时、已配对设备、生成 / 重新生成、复制、
  解除全部原地完成），独立弹窗只留一个薄壳。内联版**挂载即取码**（`pair.status` 有未过期的就复用，避免
  重开设置把手机正在抄的码作废；没有才 `pair.start`），所以分区打开就能读到地址与配对码。③ 手机编辑器正文字号可从 header 的 **A- / A+** 调
  （14–34，默认 19，存 `SharedPreferences`，行距跟着字号的 0.5 倍走），而且**长章不再卡**：
  `afterTextChanged` 过去每敲一个字就把整章 `editable.toString()` 复制一遍、再跑一次去空白正则数字数；
  现在字数改成打字停下 260ms 后从输入框读一次（`recount()`），保存仍走 1.2s 防抖，`flush()` 直接从输入框
  取正文、不再依赖那份延迟同步的副本。④ 书架每本书带**同步状态**标签（「已同步」/「有改动待同步」/
  「还没有同步过」）：`Store` 记 `bookId → updatedAt`，`SyncEngine` 每次同步成功后 `markBooksSynced()`，
  字数也改成按 `updatedAt` 缓存、用逐码点的 `Library.words()` 算（不再 `replaceAll`）。⑤ **白天 / 黑夜主题**：
  新增 `Skin.java`（`res/values-night/` 一整套配色 + `attachBaseContext` 里改 `uiMode`，第一帧就是对的），
  书架、章列表、编辑器、配对页 header 都有 ☀ / ☾ 开关，`recreate()` 立即生效，状态栏与导航栏图标跟着反色。
  刻意没用 AppCompatDelegate —— 工程没有 AndroidX、单 dex。
- 第三十七轮（R37）改造：**把插件从头到尾审一遍** —— ① 手机端：编辑章正文后无条件 `touch()`，
  「打开看一眼就返回」也算修改、配对时用电脑的库**覆盖**手机上离线写的书、`Store` 的 `synchronized`
  因为每次 `new Store()` 形同虚设（改成静态锁）、删章不写墓碑、相机授权后预览不开、`SyncEngine` 推完不
  `markSynced`、Manifest 里 Wi-Fi 状态广播的 action 拼错（`wifi.supply` → `wifi.supplicant`）、
  `SyncService` 忙时把同步请求直接丢掉（改成就绪后补跑一次）；② 同步核心 `lib/lansync.js` 的
  `push` / `pull` / `apply` 各自「读 → 合并 → 写」却没有串行化，手机与桌面同时推时后写的会把先写合并进来的
  书整本丢掉（新增 `withStateLock`，`verify-host` 里有并发三推的回归用例）；③ 加密与保存的竞态：锁屏落地的
  那一刻保存，可能把 `enc:v1:` 密文用明文覆盖（现在发现「开始时开着加密、写完却已是明文」就放弃这次写入）；
  ④ 列表与编辑器：保存中继续输入会显示「已保存」但其实没落盘、删章后跳错邻居章、章节移动没有串行化、
  中文输入法选词按 Enter 会误触发查找 / 替换 / 书架搜索、跨小说搜索常打开错的章；⑤ 对话框：只按 Esc
  关掉了下面那层（新增 Esc 所有者栈）、校对与排版的建议在正文改动后仍可应用（现在拦住并要求重跑）、
  版本恢复不落快照、配对成功轮询永远不触发（依赖数组里有个每秒变化的值）、「⋯ → 导出」在别的章上静默
  导出当前章、投稿准备切刊后永久卡在 preparing；⑥ 宿主：SMTP 的 15 秒超时是整段会话一锤子计时（大附件
  必失败，改为每条命令重置）、IMAP 删信失败就回落整箱 `EXPUNGE`（会清掉全邮箱其它已删除邮件，改为只对
  没有 `UIDPLUS` 的服务器回落）、RFC 2047 相邻 encoded-word 之间的折行空白被塞进主题、`secrets` 遇到长度
  不对的 `key.bin` 直接换钥让 `store.enc` 永久解不开（改成改名留档并警告）、模型用 json 代码块围栏包住的
  写作建议会被解析成空；⑦ 测试基础设施：`scripts/verify-host.mjs` 因为云备份删除留下的
  `lib/cloud.js` 静态 import，**从 R9 起就一直跑不起来**，已移除那 500 多行遗留用例、把 docx / 镜像的过期
  断言改到 R11 / R16 的现状、并补上 lansync 合并与并发用例 —— 现在 **174 项全过**；
  `scripts/verify-docs.mjs` 的两条排版断言（12pt / 480 twips）改成实际契约 14pt / 560 twips，**44 项全过**。
- 第三十六轮（R36）改造：**手机不再显示密文** —— 开着「正文加密存储」时，IndexedDB 里存的是
  `enc:v1:` 密文，而 `sync.push` 原样把密文推给宿主、宿主再原样发给手机，手机没有密钥，
  于是正文章节显示成 `enc:v1:…`。现在桌面在推送前解密（只有它持有密钥），手机收到的是正文；
  为本机拉回来的改动会按当时的加密状态重新封存，不会在加密库里留下唯一一条明文。
  宿主侧的同步缓存 `sync-state.json` 也改成用本机密钥加密落盘（`NWENC1` 容器，与文件夹镜像同一把
  派生密钥），否则「推明文」等于把加密悄悄关掉。旧缓存里的密文书靠合并规则第 5 条洗回明文：
  一本**整本都是密文**的书永远输给可读的那份，不受时间戳平局影响。
- 第三十五轮（R35）改造：**扫码预览取景 + 一键导出全部 + 首页更瘦** —— ① 手机扫码页面预览从来没调过
  `setDisplayOrientation`（传感器是横的），竖着拿手机看到的是旋过 90° 又被拉伸的画面，二维码自然对不上；
  现在按 `CameraInfo.orientation` 与当前屏幕旋转算出旋转角并在 `surfaceCreated` / `surfaceChanged` 两处应用，
  预览尺寸也改成从 `getSupportedPreviewSizes()` 里挑最接近 16:9 的一档（原先直接要 1280×720，
  设备不支持时 `setParameters` 抛异常、静默退回默认尺寸）。解码时若第一帧没命中，再把图像转 90°/180°/270°
  各试一次，横竖怎么拿都能扫。② **一键导出全部书籍**：设置 → 导出与文件里新增一行，按当前默认格式把每部作品
  各导成一个文件、打成一个 zip 下载（同名自动加 `(2)`/`(3)` 后缀，个别失败不拖垮整批，结果 toast 报
  「已导出 N 部 / M 部失败」）；Host 端导出逻辑抽成 `buildBookFile()`，单本与全量共用一条路径。
  ③ 首页底部那张「快捷入口」卡删掉，**期刊库 / 投稿管理升到顶部动作行**（与「投稿」并排），
  少一屏滚动、少一次点击。
- 第三十四轮（R34）改造：**手机同步 + 手机 App + 模型自动回退** —— ① 新增 Android 客户端（`app/`，
  约 2000 行手写 Java，零第三方 UI 库，只有扫码用到 ZXing），配对后与桌面双向同步；桌面侧新增
  `lib/lansync.js`（配对 / 签名 / 合并）与 `lib/lansync-server.js`（`0.0.0.0` 上的最小 LAN 监听，默认 41288），
  因为 `dsh web` 只监听 127.0.0.1，手机根本连不上。② 校对 / 修改建议 / 投稿三处 AI 调用在模型失败时
  **自动换下一个候选**（设置里选的 → Harness 当前默认 → 列表其余），只有全部失败才弹「换个模型重试」
  选择器，成功时告知「原模型没有响应，已改用 X」。③ 修掉两个真 bug：一本书被删除之后又被编辑时，
  墓碑的胜负判断写反了，「复活」永远不生效、书会永久消失；`pair.info` 把 UDP 发现端口（41287）当成
  手机该连的 Web 端口上报。④ 新增「设置 → 手机同步」分区与配对面板（**默认照着面板手填「电脑地址 + 配对码」**，
  扫码是备选），以及可直接安装的 `dist/精神空间.apk`（0.52 MB）。
- 第三十三轮（R33）改造：点写作页左上角的**首页**时，回首页的同时**把目录也展开** —— 首页就是挑书的地方，
  目录还收着会让人以为按钮没反应。既然首页已经能把目录叫回来，左上角那枚**「目录开合」按钮就删掉了**，
  胶囊里只剩「首页 | 发丝线 | 锁定」两枚。目录收起时写作列左缘的竖排「目录」把手恢复常驻（沉浸模式除外），
  键盘 `Ctrl/Cmd + \` 依旧可用。窄面板、沉浸模式、blur-flush 三处行为不变。
- 第二十七轮（R27）改造：**三个问题** —— ① 编辑器左上角的三个按钮（首页 / 目录 / 锁定）会和灵感便签「打架」：
  便签让道是靠给写作列加 `padding-left:348px`，而按钮组锚在 `.nw-surface` 左缘，surface 被推走 348px，
  按钮于是看起来扑到纸上。现在**车道改成加在 `.nw-surface` 自己身上**——surface 仍占满整列、左缘不动，
  滚动区与纸面从车道结束处开始，按钮永远钉在原地（实测便签开关前后 `acts` 恒为 `{x:294,y:10}`，
  与卡片 / 胶囊 / 纸面零重叠，窄面板 ≤820px 车道自动释放）。② 便签「点击能收起」原先没有可见目标：
  胶囊在展开时 `opacity:0`、唯一收起键只在 hover 时显形；现在胶囊常驻（0.72 不透明度）并把文字切成
  **「灵感」/「收起」**，点它即可折叠，状态还记在 `localStorage`，**不点就一直保持展开**。
  ③ **期刊推荐改由大模型判断**（详见「投稿助手」一节）：规则分只用来筛候选，模型读稿件开头 2400 字后
  给出 `fit` / 一句判断 / 两三句理由 / 质量档（够格 / 略欠 / 尚不足），卡面如实标注是哪一种推荐。
- 第二十六轮（R26）改造：**又一轮查错** —— ① 状态栏的「未保存」分支从来没有被触发过（`saveState === 'dirty'`
  写好了却没有任何 `setSaveState('dirty')`），打字后整整 1.2 秒仍显示「已保存」；现在编辑器在 `handleInput` /
  `afterEdit` / `setEditorText` 三处即时通知，且**打回原样时会回到「已保存」**（`commitSave` 的跳过分支补了
  `onDirty(false)`，否则状态会永久卡住、`beforeunload` 一直拦人）。② 一键排版在「无可改之处」时仍显示一行
  幽灵 `+`、应用按钮可点：`typeset()` 总会把末尾补成一个 `\n`，`diffPreview` 把它当成新增行；已在比较前剥掉
  一侧尾换行。③ 「为你推荐」所有期刊分数都是 82、实际按字母排序：新增「专收某体裁」与「篇幅贴合该刊收稿上限」
  两个可解释的区分维度，面板也从「只显示前两条理由」改成**滤掉几乎人人都有的邮箱提示、显示三条理由**。
  （R27 ③ 已把这条推荐整体换成模型判断，规则分降级为候选筛选。）
- 第二十五轮（R25）改造：**修改建议栏自动适应宽度** —— 用户说「在右侧太窄了，自动适应宽度，紧挨输入区」。
  栏宽从固定 336px 改成 `flex:1 1 300px` + `min-width:300px` + `max-width:560px`，**吃掉正文用不完的宽度**
  （宽屏实测 560px，与纸之间只剩 16px 页边距，没有死白）；同时纸面 `flex:0 1 auto; width:calc(min(页宽,100%) + 32px)`
  停止生长，两块作为整体居中。拖把手仍可手定 300–640px，**双击 / Home 回到自动**；`[data-manual="1"]` 把
  max-width 放到 640px，否则拖过 560 毫无反应。窄面板 ≤780px 自动宽度收到 `min(320px,42%)`。
- 第二十四轮（R24）改造：**灵感便签挪到左侧并独占一条车道** —— 原来它浮在纸面右上角，会压住正文第一行
  （用户：「左侧没东西」）。现在 `left:14px`，宽 420 → **320px**，写作列给它让出 348px 的 `padding-left`
  （`data-notes-lane` 只在卡片真的打开时才置 1，关着不占位）；顺带解决了与查找栏的争位——查找栏在
  `top:10px right:14px`，两者现在各占一角。车道按 **`.nw-bench` 容器宽度**预算（不是面板宽度），因为
  目录或建议栏展开时 bench 才是真正被挤压的那个；bench < 820px 时车道取消、卡片回到浮层并收窄。
- 第二十三轮（R23）改造：**修改建议的对照阅读** —— 打开建议栏时**自动收起左侧目录**（三栏并排会把纸挤到
  550px，建议与原文就变成上下堆叠了；关掉建议栏时只在「原本是打开的」情况下恢复目录）；新增编辑器 API
  `centerRange(start,end)`，点一条建议会把**原文那句精确滚到屏幕上下中间**，同时建议卡也滚到同一条水平带
  （实测两者中线差 0–20px，面板中线 384 / 视口 401）；**双向同色下划线**：建议卡里的引用去掉左侧竖条改为
  2px 品牌色下划线，原文对应句也换成同一根下划线（底色由 55% 降到 30%，让人读得清字），两边都用 `--nw-brand`
  保证永不色差。
- 第二十二轮（R22）改造：**功能与操作逻辑打磨** —— 删除章节后落到**相邻的一章**（原来会跳到整库第一章，
  可能是另一本书）；新建章节**自动编号**（「新章节 2 / 3 …」，不再一章十节全叫「新章节」）；
  删除后弹**带「撤销」的 toast**（6 秒，点一下从回收站原样恢复并重新选中）；**视图会记住**（关掉再打开
  停在上次那一页）；**每本书记住上次读到的章节**；书架章节树支持**上下键 / Home / End / F2 重命名 /
  Delete 删除**（原来只能 Tab 逐个走），搜索框支持**回车直接打开第一条命中、Esc 清空**；编辑器新增
  **Alt+N 新建章节、Alt+A 开关修改建议栏**（`Ctrl+N` 会被浏览器抢走，故用 Alt）。
- 第二十一轮（R21）改造：**纸面真正浮起来**（`.nw-page` 在宽面板下有了底色、细边与纸张阴影，此前
  `background` 是透明的，阴影投在空气里）；写作页三个角落按钮的**不透明度 0.55 → 0.78**（暖色下 0.55
  读作禁用）；书架**选中章**改用品牌色 7% 淡染，与选中书卡区分开；**书卡封面**从「一道居中竖条」（像
  暂停键）改成竖长书形（左深书脊 + 右浅书口）；首页副标题不再被渲染成灰胶囊（`.nw-welcome-sub` 与列表行
  共用类名，已拆出 `.nw-welcome-lead`）；创作统计固定 **2×2**（原来 3+1 掉行）；**浮动坞与便签钮跟随主题**
  （FAB 用品牌色填充，静止不透明度 0.35 → 0.88）；便签卡宽度修到 **420px**（绝对定位父级 shrink-to-fit
  导致百分比塌成 200px）；建议栏手动输入框 52px 高、面板子元素不再缩到文字宽。
- 第二十轮（R20）修复：投稿生成的 Word **书名不再重复**（稿模式页眉原来在所有页都印「书名 · 作者」，
  与正文标题块撞车，已用 `<w:titlePg/>` + 空白首页页眉解决，首页页码仍保留）；**全套图标重画**（画布
  16×16 → **20×20**、统一 round caps、按尺寸分档描边 `strokeFor`，齿轮改成滑轨旋钮、书改成书脊+书页线）。
- 第十四轮（R14）改造：**短篇不再被强行分章** —— 单章作品导出 / 投稿排版时去掉「一、」编号，自动生成的
  「新章节」标题整体不输出（`continuous` 开关默认在单章时打开）；**点开邮件即标已读**（`BODY.PEEK[]` 取正文后
  补 `UID STORE +FLAGS (\Seen)`，首页未读数随之刷新）；**灵感便签改为自动保存 + 按章独立 + 随文字自动拉高**；
  侧栏**顶栏的齿轮（设置）移除**，只留页脚那一个。
- 第十三轮（R13）改造：**整套布局改成按「面板宽度」响应** —— `.nw-root` 声明为命名容器
  `container:nw / inline-size`，新增三档 `@container` 断点（≤980 / ≤780 / ≤560），此前 10 处断点全是
  视口断点（宿主侧栏一拉开、窗口再宽，正文列仍会被挤坏）；**灵感便签从整页改回悬浮卡片**
  （420×320 以内、钉在写作列右上角、让开查找栏、不占正文留白），修掉「看着好瘦长」。
- 第十二轮（R12）改造：写作页左上角新增**首页按钮**；新增**修改建议栏**——大模型通读本章后给出可
  点击定位的意见，面板与正文**左右并列**（不是弹窗）；投稿选定期刊后**直接生成整封邮件进预览**，
  不用再手动点「生成」；**收件箱邮件可点击阅读**（补零依赖 IMAP `BODY.PEEK[]` 取全文 + 读信弹窗）。
- 第十一轮（R11）改造：插件改名 **精神空间**；修首页「正在创作」点不进编辑页；修 163/126 收件箱
  `Unsafe Login`（补 RFC 2971 `ID` 握手）；**灵感便签改成纯色整页**；**光标可设置**（粗细/颜色/闪烁）；
  投稿邮件**不再复述期刊征稿要求**；**期刊库支持增删改查**；附带一键上传 GitHub 的脚本。
- 第五轮（R5）改造：删掉整条顶部工具栏、新增**欢迎首页**、主题扩到**八套**、设置改**左右两栏**、
  投稿向导改**四步**并带**智能推荐**、期刊库扩到 **79 家**、新增**投稿管理**、图标换成内联 SVG、
  SMTP 加**端口自愈矩阵**、**移除阿里云盘**。
- 第九轮（R9）改造：**删除整个云备份**（云端代码、面板、`lib/cloud.js` 全部移除），改成**选本地文件夹 +
  每次改动自动写加密文件 + 可从文件夹或单个 `.nwe` 备份恢复**；投稿向导重排为**选小说 → 选期刊 → 邮件预览**
  且预览页所有字段可改；新增**零依赖 IMAP 收件箱**（首页显示编辑部回信与未读）；新增
  `scripts/verify-client-load.mjs` 并把「bundle 能否被加载」接进构建闸门。
- 第十轮（R10）改造：保存与恢复**去重成一个面板**、落盘格式从 `.md` 换成 **`.docx`**、
  悬浮坞只留**三项写作动作**、新增**灵感便签**浮动栏（自动让出正文留白）、投稿附件改成**稿模式 docx 且可下载**、
  期刊补**按字数区间的多种收稿邮箱**、新增**杂志主题**（共九套）、**所有主题背景改纯色**（去掉方格纸纹）。
- 第十六轮（R16）改造：文件格式**只留 `.nwe`**，「明文副本」的开关、按钮与状态文案全部移除（连
  R15 留在 `settings.json` 里的 `plain` 字段也清掉了）；写作页左上角变成**三个小图标按钮**（首页 / 目录 /
  锁定，28×28，不再是带字的胶囊），侧栏收起时不必再回到左缘竖排把手；灵感便签**去掉上下两条边框栏**，
  状态字与关闭按钮改成 hover 才出现的浮层；首页三类列表**每类最多 3 条、按时间倒序、超出折叠成
  「展开全部 N 条」**，收件箱每行多一个**删除**键（IMAP `\Deleted` + `EXPUNGE`）；设置新增
  **「统计字数包含标点符号」**（默认开，客户端与 Host 同口径，书籍总字数与投稿字数一起变）；期刊新增
  **水平等级**（国家级 / 省级 / 市级 / 其他，由原有标签推导，投稿时以徽章展示）；修好导入后**首行从中间
  开始**、投稿页**书籍字数显示 0**、侧栏**「导入小说」重复入口**三处问题。
- 第十五轮（R15）改造：自动保存面板新增「**同时保存一份明文 .docx**」开关（`plain`），
  让每部小说的可读副本跟着每次保存自动更新，不必再手动点「解密出明文副本」；关掉开关时下一次保存会删除遗留的明文副本。
  （R16 起该开关已移除，见上。）

**入口速查**：写作页左上角两个小图标 = 首页（顺带展开目录）/ 锁定（R33 起目录开合按钮已删）· 侧栏顶部 = 首页 / 沉浸 /
宿主侧栏 / 锁定 / 收起（R14 起设置只在**页脚**）· 目录页脚 = 新建小说 / 新建章节 / **导入** / 回收站 / 设置 ·
每本书/章行的「⋯」= 导出 · 右下 `✎` 坞 = AI 校对 / 一键排版 / 投稿 · 写作页右缘 `✦ 灵感` = 便签 ·
**自动保存**：设置 → 导出与文件 →「自动保存与恢复…」· **收件箱**：首页右上（设置 → 投稿里配 IMAP）。

| 主界面（Claude 主题） | 浮动坞展开 |
| --- | --- |
| ![主界面](docs/screenshots/final-01-canvas.png) | ![浮动坞](docs/screenshots/final-02-dock.png) |

| 设置 | 投稿向导 |
| --- | --- |
| ![设置](docs/screenshots/final-03-settings.png) | ![投稿向导](docs/screenshots/final-04b-submit-journal.png) |

| 沉浸模式（无顶栏，Esc 退出） | 黑夜主题 |
| --- | --- |
| ![沉浸模式](docs/screenshots/final-06-immersive.png) | ![黑夜主题](docs/screenshots/final-07-night.png) |

> 截图取自真实构建产物挂在自建宿主页（真 React + 活 Host API）的实拍，不是设计稿。
> **注意**：这批截图拍于 R5/R9，工具栏、浮动坞（R10 只剩三项）、主题数量（R10 为九套）与保存面板
> （R9 起改为「自动保存与恢复」）都已有变化，以本文文字说明为准。

---

## 1. 安装

插件包目录即本仓库根。在 DSH 里执行：

```
plugin_manager action=install_bundle target=C:\Users\17737\Desktop\dsh\编码区\novel-writer
```

安装后：

- 入口为 entryId `include:novel-writer`（`list_plugins` 可查），状态应为 `enabled:true` / `fiberPhase:"active"`；
- 左侧栏出现书本图标（order 5，位于插件与市场之间），点击切到「精神空间」主面板；
- 校验 Host 是否就绪（**Web 端口每次启动都会变**，用 `dsh web` 打印的端口或桌面版实际端口）：

```
GET http://127.0.0.1:<web端口>/novel-writer/api/ping
→ {"ok":true,"data":{"name":"novel-writer","version":"1.2.0","capabilities":{...}}}
```

> 包名仍是 `novel-writer`（`@local/novel-writer`、entryId `include:novel-writer`、API 前缀 `/novel-writer/api`），
> 只有**显示名**改成了「精神空间」。改包名会让已安装的 profile 指向一个不存在的目录，得不偿失。

> 若浏览器里点「AI 校对 / 云备份」报 405，说明 Host 的 HTTP 路由没注册成功（旧版在 web 宿主上
> mount 时机过早读不到 `webServer`）。本版 `index.js` 用 `ctx.inject(['webServer'], …)` 延迟注册，
> 405 已消除；升级后请**重载插件并刷新页面**（浏览器可能还缓存着旧 bundle）。

**改动 Host 代码后必须重载插件**（Node 模块已缓存，热改文件不生效）：

```
plugin_manager action=set_plugin target=include:novel-writer enabled=false
plugin_manager action=set_plugin target=include:novel-writer enabled=true
```

只改客户端代码则重建产物即可，浏览器刷新后生效：

```
node scripts/build-client.mjs      # client/src/*.js → client/client.js
node --check client/client.js
```

`build-client.mjs` 结束前会自动跑一次 **加载闸门**（`scripts/verify-client-load.mjs`）：用假的
`window.__ModuleLoader__` + 只解析 `react` 的 `require` 把产物整个 eval 一遍，断言导出了
`inject: ["slots"]` 与 `apply`。**语法检查抓不到的「反引号提前闭合模板字符串」只有这道闸门能拦住** ——
CSS 是用模板字符串写的，注释里多写一个反引号就会让整块样式变成语法错误。

### 上传到 GitHub（R11 首次上传 · R39 改成每次提交自动上传）

本机没有全局安装 git / gh，所以工具是**便携版**放在 `.tools/`（已被 `.gitignore` 忽略，不进仓库）：

- `.tools/git/` — PortableGit 2.56（`git.exe`）
- `.tools/gh-token.txt` — 你的 GitHub Token（同样被忽略，**永远不要提交**）
- `.tools/github.json` — 仓库坐标（`{"owner":"…","repo":"novel-writer","branch":"main"}`）
- `.tools/push.log` / `.tools/push-pending` — 自动上传的日志与失败待重试标记

**一次性配置**（三步，之后全自动）：

1. 生成 classic token，只勾 `repo`：
   <https://github.com/settings/tokens/new?scopes=repo&description=mindspace>
2. 把 token 写进 `.tools/gh-token.txt`（单行，别带空格），再写 `.tools/github.json`：
   ```json
   { "owner": "你的用户名", "repo": "novel-writer", "branch": "main" }
   ```
3. 启用钩子：`node tools/auto-push.mjs --install`（等价于 `git config core.hooksPath .githooks`）。

当前已配置为 **`Jokii-Joy/novel-writer`（public, main）**；本仓库的提交身份已设为
`Jokii-Joy <39142551+Jokii-Joy@users.noreply.github.com>`（GitHub 的 noreply 地址，不暴露真实邮箱）。

之后**每次 `git commit` 都会自动上传**：`.githooks/post-commit` 立刻返回，`tools/auto-push.mjs`
在后台把当前分支 `git push` 到 `origin`。网络抖动时最多重试 4 次（0/5/15/45 秒退避），
仍然失败就写进 `.tools/push-pending`，下次提交或手动跑一次 `node tools/auto-push.mjs` 会补上。
token 通过一次性的 `http.extraheader` 传给 git，**不写进 remote URL、不写进 `.git/config`**。

> **R40 补：这个网络会把 `github.com` 解析到一个连不通的边缘地址。** 本机 DNS 返回
> `20.205.243.166`，TCP 443 直接黑洞（`curl 000`、`git push` 每次卡 21 秒再报
> `Failed to connect to github.com:443`），而同一时刻 `api.github.com` 与美区边缘
> （`140.82.112.3` 等）都是 200。`auto-push.mjs` 现在会先用 3 秒超时逐个探活候选地址
> （缓存的上次成功地址 → 系统 DNS → 四个已知可用边缘），**第一次仍按域名直连**，之后每次重试
> 换一个探活通过的地址，通过 `git -c http.curloptResolve=github.com:443:IP` 钉住，
> 成功后把该地址写进 `.tools/github-ip` 下次优先。**不动系统 hosts 文件**（需要管理员权限，
> 而且会把一次性的 DNS 故障变成永久配置）。

常用命令：

```bash
node tools/auto-push.mjs --status    # 仓库坐标 / token 是否就位 / 上次成功时间 / 是否有待重试
node tools/auto-push.mjs             # 立刻推一次（前台，看得到重试过程）
tail -n 20 .tools/push.log           # 后台上传的日志
```

> 首次建仓若想走 REST API（完全不碰 `github.com`），仍可用 `tools/publish-github.mjs`：
> 它读同一个 token 文件，调 `api.github.com` 建仓库并把被 git 跟踪的文件逐个上传
> （blobs → tree → commit → ref）。这条路绕开 `github.com`，适合 git 协议完全连不上的时候；
> 但它每次上传都是一个全新的提交，不保留本地历史，所以只建议用来建第一个提交。
>
> Token 只需要 `repo` 权限。也可以完全不跑脚本，用 GitHub 网页「Upload files」把这个目录
> （除 `.tools/`）传上去。


---

## 2. 功能

### 布局与外壳
- 单窗口左右分栏：左侧目录、右侧写作面，中间分隔条可拖拽（220–640px）、方向键微调 ±16px、双击复位 272px，宽度记忆在 localStorage。
- **没有顶部工具栏**（R5 删除）：写作面从面板最顶端开始，只剩侧栏头和底部状态栏。
- **目录可隐藏**：侧栏 topbar 最右的 `‹`，或写作区左缘常驻的 `›目录` 把手（目录隐藏后它才出现，键盘 `Ctrl/Cmd + \` 同样有效）。
  状态记在 `localStorage['nw.shelfOpen']`；隐藏后写作面占满宽度。
- **进入面板时自动收起宿主左侧栏**（`layout.toggleSidebar()`，用 `sessionStorage` 做一次性守卫）；侧栏头 `▥` 随时切回，并给出「已收起 / 已展开宿主左侧栏」的 toast。
- 底部状态栏一行显示保存状态、保存时间、本章 / 本书 / 全部字数、自动保存状态、光标行列。

### 响应式（R13 ①：按面板宽度，不按窗口宽度）
插件的实际宽度与浏览器窗口几乎无关 —— 它在宿主 shell 里只是一列（宿主侧栏 264–420px + 右栏），
1440px 的窗口里正文列经常只有 500–700px。所以所有排版断点都量 `.nw-root` 而不是视口：
- `.nw-root` 在 `05-css.js` 里声明为命名容器：`container-type:inline-size; container-name:nw`，
  新增的断点全部写成 `@container nw (max-width: …)`；旧写法里 `97-theme.js` 那段还留了一份
  `@supports not (container-type:inline-size)` 的视口兜底，给不支持容器查询的引擎用。
- **三档**（`client/src/98b-responsive.js`）：
  - `≤980`：`.nw-grid2` 单列、设置左导航收窄到 132px、投稿列表限高、坞贴边、状态栏间距收紧；
  - `≤780`：**对话框撑满面板**（`max-width:100%`）、设置从「左栏 + 右栏」变成「顶部横向滚动标签 + 内容」
    （导航 `position:static; overflow-x:auto`，内容不再内滚，改由对话框整体滚）、首页三块 grid 单列、
    侧栏加 `max-width:min(62%,300px)` 的软上限（宽度来自行内 style，CSS 只能设上限）、修改建议栏收到 `min(280px,40%)`；
  - `≤560`：**侧栏与修改建议栏都不再占位，改为浮层**（侧栏 `z-index:34` 盖住 `z-index:30` 的坞，
    否则窄面板里侧栏底部的按钮会被坞压住），分隔条隐藏（没得拖），正文左右内边距收到 20px，
    灵感便签变成左右各 8px 的通条，状态栏允许换行、隐藏「灵感」文字标签。
- 原有五处视口断点也逐个换成了容器查询：编辑器页边距（`60-editor.js`）、设置两栏（`45-dialogs-css.js`）、
  投稿两栏、首页卡片（`55-welcome.js`）、精修层的窄屏规则（`97-theme.js`）。
- 尺寸里凡是原先用 `vw` / `vh` 的，横向一律换成 `cqw`（`padding` 的横向分量、标题 `font-size`、
  toast 的 `max-width`）；**纵向仍用 `vh`**，因为 `inline-size` 容器没有高度轴。
- 所有 `grid-template-columns` 的硬下限都套了 `min(…,100%)`（如 `minmax(min(280px,100%),1fr)`），
  这样在比下限还窄的面板里是「一列」而不是「溢出」。
- 触屏（`@media (hover: none)`）把平时靠 hover 才显现的控件（章节行动作、便签胶囊、首页按钮、坞）改为常显。

### 欢迎首页（R5 默认屏）
- 打开插件先到**首页**而不是上次的章节：`view: 'home' | 'write'`，默认 `home`；选中章节 / 新建首章 / 进沉浸 / 点「继续写作」才切到 `write`。
- 三张卡：**正在创作**（按最近更新排序，显示章节数 · 字数 · 日期）、**创作统计**（全书 / 本书 / 近 7 天 / 今天）、**投稿记录**（状态徽章 + 距今 N 天）。
- **快捷入口卡已取消（R35 ③）**：原来页脚还有一张「继续写作 / 期刊库 / 投稿管理 / 设置」的卡，四枚按钮都是别处也能到的动作；
  现在**期刊库**与**投稿管理**升到页头动作行，与「新建 / 导入 / 投稿」并排，页脚不再有第二排入口，少一屏滚动。
- **每类最多 3 条（R16 ⑤）**：`HOME_LIMIT = 3`，三类列表都走同一个 `foldRows()`。超出时列表下面出现
  一枚整宽的「展开全部 N 条 / 收起」按钮（`aria-expanded`，箭头 `chevdown`/`chevup`），点开就地展开、不跳页。
  排序本来就已经是「由近及远」：`rollupNovels()` 按 `touched` 倒序，收件箱按 IMAP 返回的到达顺序。
  理由：首页是「今天要做什么」的一屏，不是全量清单；六条会把下面的卡片顶出视口。
- 数据来自 `submit.record` 与 `journals.list`，任一失败都静默降级为空态；投稿成功后会主动刷新。
- **首页不画下划线**（R11）：`.nw-link` 在这页是嵌在正文里的行内按钮，一条常驻底线会被看成断裂的边框，
  所以首页统一用品牌色 + hover 下划线表达可点。编辑页与对话框里的锚点样式不受影响。

### 侧栏顶部与右下坞
侧栏 topbar 五个图标：`⌂` 首页 · `⛶` 沉浸 · `▥` 宿主侧栏 · `🔒` 锁定 · `‹` 收起目录。
（`⚙` 设置自 R14 ④ 起只在**页脚**那排里，顶栏不再重复。）
浮动坞 `.nw-dock`（`right:20px; bottom:56px`）默认半透明（`opacity:.35`），hover / 键盘聚焦时完全显现；展开后只有三项写作动作：
`AI 校对 / 一键排版 / 投稿`。首页、主题、打字机、锁定、设置这类入口都在设置面板或侧栏里，坞不再扮演第二个工具栏（R10 精简）。
写作面通过 `--nw-gutter-x` 自动让出右侧 ≥88px，文本块仍然居中，浮层不压正文。
「修改建议」在正文**右侧另开一列**而不是浮在文字上，所以它占的是布局宽度、不是留白——正文列会相应收窄，不会被挡住。

### 沉浸模式
`⛶` 或 `Esc` 进出（进入时 toast 提示「按 Esc 退出」）。**没有任何顶栏**：工具栏、目录、分隔条、状态栏、浮动坞全部卸载，只剩满屏写作面。
页宽放宽到 `max(页宽, 880px)`、上下留白 96px，并自动打开打字机模式；`Esc` 只退出沉浸、不动正文。

### 九套主题（默认 Claude）
| id | 名称 | 纸面 | 墨色 | 强调 | 形态语言 |
| --- | --- | --- | --- | --- | --- |
| `claude` | Claude（默认） | `#faf9f5` | `#141413` | `#d97757` | 圆角 12 / 10 / 16 |
| `harness` | Harness 默认 | 跟随宿主 | 跟随宿主 | 跟随宿主 | 跟随宿主 |
| `card` | 极简卡片 | `#ffffff` | `#17181a` | `#3b6ea5` | 圆角 16、无描边靠阴影、无衬线 |
| `eye` | 护眼 | `#cce8cf` | `#1f2a20` | `#2f6b3c` | 同 Claude |
| `night` | 黑夜 | `#1a1a18` | `#e8e6dc` | `#e08d6f` | 同 Claude，深色 |
| `ink` | 水墨 | `#f4f2ec` | `#1a1a18` | `#2b2b28` | 同 Claude |
| `newspaper` | 报纸 | `#f2eee2` | `#1c1b17` | `#8c2b22` | 圆角 2、全衬线、标题 small-caps、2px 分隔线 |
| `magazine` | 杂志（R10） | `#ffffff` | `#14171a` | `#d0021b` 编辑红 | 圆角 14、无衬线界面 + 衬线正文、小节标题下 2px 红条、激活动作红条 |
| `guofeng` | 国风 | `#f5f1e6` | `#23211b` | `#a8442f` | 圆角 8、楷体正文 + 宋体界面、主按钮朱砂印 |

主题**同时接管整个外壳**（侧栏 / 对话框 / 状态栏 / 浮动坞 / 首页），不是只染正文：`client/src/98-shell-theme.js`
在 `.nw-root[data-theme=…]` 作用域内重映射 `--dsw-alias-*`，并顺手改圆角与字体族，插件内所有颜色都从这层派生，宿主自身 chrome 不受影响。
`harness` 不写任何重映射分支，就是宿主原色。旧主题 id 自动迁移：`light→claude`、`dark→night`、`parchment→ink`。
**背景一律纯色**（R10）：早期两套主题的纸纹用两向 `repeating-linear-gradient` 叠出方格，已全部改回 `--nw-texture:none`。

### 图标
全部内联 SVG（`client/src/42-icons.js`，`NW.icon(name, {size, weight})`）：16×16 viewBox、`stroke:currentColor`、
stroke 1.5、圆头圆角，60 个名字覆盖新建 / 编辑 / 导航 / 上传下载 / 写作工具 / 状态。不再出现 `☰ ▢ ⛶ ⚙ 🔒 ✍ ¶ ✉ ×` 这类文本字形，
因此不会因宿主字体缺失变豆腐块，换主题时只跟着 `color` 变。

### 视觉语言
- Claude 设计语言：16px UI 基准 / 14px 次级 / 13px 小字 / 1.55 行高；圆角 卡片 12 / 控件 10 / 模态 16 / 胶囊 999；按钮 36px、图标按钮 34px、输入 38px、工具栏 52px、状态栏 34px；间距 8 / 10 / 12 / 16 / 20 / 24。
- 层叠背景由前景墨色 `color-mix` 派生（宿主浅色 layer token 全是纯白，直接映射会让层次完全看不见）。
- 输入控件统一 2px 品牌焦点环；卡片 hover 抬升 1px；激活动作左侧 3px 品牌强调条；细滚动条。
- 动效由 `96-motion.js` 统一发布：`nw-fade-up`（对话框/折叠区升起）、`nw-toast-in`、`nw-slide`、`nw-pop`（浮动菜单/坞展开）、按钮 `:active` 0.97 缩放，时长 `--nw-dur: .18s`。
- `prefers-reduced-motion: reduce` 下所有动画与位移归零。

### 目录
- 小说 → 章节（含嵌套子章节）两层树，深度优先顺序持久化；行高 36px、缩进 14px/级、层级连接线。
- 新建 / 重命名 / 删除（进回收站）/ 拖拽排序（HTML5 DnD，2px 插入线）/ 搜索（300ms 防抖，命中正文关键词）。
- 每项显示名称、更新时间（当天 `HH:mm`、当年 `MM-DD`、跨年 `YYYY-MM-DD`）、字数；小说卡带 28×28 渐变小封面。
- 每行 hover 出现「⋯」菜单：导出 / 重命名 / 删除；底部五个 40×40 图标按钮（新建小说 / 新建章节 / **导入小说** / 回收站 / 设置）。
  R16 ⑨ 删掉了原来重复的那条整宽「导入小说」大按钮 —— 同一件事两个入口，用户会以为它们是不同功能。
- 新建小说自动创建首章；点章节即切换，切换前 `flush()` 强制落盘。

### 编辑器
- 纯文本 / Markdown 源文编辑，三层叠放（高亮镜像层 + 粗光标层 + 透明 textarea），不引入富文本 contenteditable。
- **左上角图标胶囊（R12 ① / R16 ②③ / R30 / R33）**：`.nw-surface-acts` 是一条 26px 高的分段胶囊，内含
  **首页**（`⌂`）｜一条 1px 发丝线｜**锁定**（`🔒`）。R33 删掉了原来的第二枚「目录开合」——
  **首页点击时同时** `setView('home')` **与** `setShelfOpen(true)`，回到挑书页目录本来就是展开的，
  再单独留一个开合键只会让人猜这两个按钮有什么区别。发丝线保留：锁定是这一排唯一的破坏性操作。
  默认 `opacity .55`、hover 变 1、沉浸态降到 `.28`；每个 `onClick` 都先 `preventDefault()`，
  避免点击触发 textarea 的 blur-flush 再重入。首页按钮仍是必需的而不是装饰：沉浸模式下侧栏与工具栏都会被卸载，
  没有它就只能靠 Esc 退出再找入口。
  目录收起时，写作列左缘恢复一枚竖排「目录」把手（R33 起在写作页也常驻，沉浸模式除外），
  键盘 `Ctrl/Cmd + \` 也能开合。
- **加粗加黑光标**：`caret-color: transparent` + 绝对定位 `.nw-cursor`（默认 `--nw-caret-width: 3px`、高 = 1.2em、墨色 `--nw-caret-color` 近黑 `#0f0f0e`），位置复用同一套 `measureCaret()` 测量，`translate3d` 只在位置变化时写；有选区 / 输入法组合中 / 窗口失焦时自动隐藏；1.06s `step-end` 闪烁，切换两个等价 keyframes 重启闪烁且零 reflow。
- **光标可设置（R11）**：设置 →「外观」里有三项 —— **粗细**（1–8px 滑块，默认 3px）、**颜色**（取色器 + 文本框，留空表示跟随主题；九套主题各自有一份默认墨色）、**闪烁**（开关，关掉后 `data-caret-blink="0"` 让 `animation: none`）。
  实现细节：粗细/颜色写进 `.nw-surface` 的 CSS 变量，闪烁写 `data-*` 属性而**不写内联 style** —— 因为 `paintCaret()` 每帧会改写 `animationName` 来重启闪烁周期，内联值会被它悄悄打开。
- 自动保存（默认 1200ms 防抖，可配 200–60000ms），失焦 / Ctrl+S / 切章 / 卸载 / `beforeunload` 立即保存。
- 输入路径：零 setState + rAF 合帧 + read→write 两阶段；`measureCaret` 只增量改写一个 textNode；`spellCheck`/`autoCorrect`/`autoCapitalize` 全关；`.nw-stack` 加 `contain: layout style`。（R2 同步 200 字实测 0.36–0.8ms/字。）
- 字号默认 **20px**、行距 **2.0**、页宽 **760px**；老默认值（17 / 1.9 / 720，以及 R2 过渡期的 19）一次性迁移到新默认，用户自选值不动。
- 字体（宋体 / 黑体 / 楷体 / 思源宋体 / 系统等）、字号、行距、页宽实时可调。
- **字数口径统一（R16 ⑥）**：设置 →「写作」新增「**统计字数包含标点符号**」，默认开。开关是**模块级**的
  （`NW.format.setCountPunctuation()`），App 在 `settings.countPunctuation` 变化时推送一次 —— 不逐调用点传参，
  因为全 App 的计数都走 `wordCount()`，串参数必然会漏掉一处（状态栏与投稿预览对不上就是这么来的）。
  关掉后 `\p{P}` / `\p{S}` 不计入；Host 侧 `countChars(text, options)` 同步接受 `includePunctuation`，
  `submit.prepare` 载荷带 `countPunctuation`，所以**状态栏、首页书籍总字数、投稿预览与邮件主题里的字数完全一致**。
- **打字机模式**：镜像测量光标真实视觉行并滚到视口垂直中央（实测 `dist = −19px` 恒定，等于半行高；容差 ±40px）。滚动容器三路探测（`.nw-scroll` → overflow 祖先 → `document.scrollingElement`），窗口级 passive scroll 兜底，容器身份变化自动重算；手动滚轮 / 触摸 / 方向键 / PgUp/PgDn / Home/End 触发 800ms 抑制窗。
- **切章 / 导入后从第一行开始（R16 ⑦）**：打字机模式会给纸面上下各垫半个视口（`--nw-tw-room`），
  所以「滚到 0」其实停在垫出来的空白里 —— 这就是导入后正文从面板中部开始的来源。现在章节切换 effect 在
  `autosize()` 之后把 `scrollTop` 设为 `typewriterRoom(view)`（**只跳过垫出来的那部分**，页面自身的内边距照常保留），
  并同步 `expectedScrollTopRef`，避免被误判成手动滚动。
- 快捷键：`Ctrl/Cmd+B` 加粗、`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+S` 保存、`Ctrl/Cmd+F` 查找替换、`Tab` 两个全角缩进、`Esc` 关闭浮层 / 退出沉浸、`Ctrl/Cmd+Shift+L` 锁定、**`Alt+N` 新建章节**、**`Alt+A` 开关修改建议栏**（`Ctrl+N` 会被浏览器抢去开新窗口，所以用 `Alt`）。
- 书架键盘（R22）：章节树里 `↑` / `↓` 在可见行间移动、`Home` / `End` 跳首尾、`F2` 重命名、`Delete` 删除、`Enter` 打开、`←` / `→` 折叠展开；搜索框里 `Enter` 直接打开第一条命中、`Esc` 清空。
- 删除与撤销（R22）：删除章节/小说会进回收站，底部 toast 给 6 秒的「撤销」，点一下原样恢复并重新选中；删除后**落到相邻的一章**，不会跳去别的书。

### 导入 / 导出
- 导入 `txt` / `md` / `markdown` / `docx` / `epub`：自动识别章节标题切分，保留书名与作者；中文 txt 非 UTF-8 时回落 GB18030。入口在目录底部。
- 导出 `docx` / `pdf` / `epub` / `txt`：入口在书 / 章行的「⋯」菜单，可只导当前章或整本。
  - **短篇不分章（R14 ①）**：只有一章的书默认勾上「不分章节（短篇连续排版）」—— 四格式都不再输出章节标题，
    正文直接接在书名/作者下面；即使不勾，自动生成的占位标题（`新章节`、`未命名`、`第1章` 等）也会被抹掉，
    真正自己写过的章名照常保留（多章作品仍是「一、章名」编号）。投稿排版（`formatWork`）同样遵守这条规则。
  - docx：A4（11906×16838 twips）、宋体 **14pt**（四号，接近期刊通行的「小四/四号」）、首行缩进 560 twips、
    1.5 倍行距（投稿附件 1.75 倍）、Heading 1 18pt、页脚 PAGE 域。
    标题与作者居中排在第一页顶部，**其下直接接正文**（不单独起标题页、不留空白页）。
  - epub：EPUB 3，`mimetype` 首条且不压缩，含 container / OPF / nav / toc.ncx；无标题的单章不渲染空 `<h1>`。
  - pdf：优先 Harness `officeToPdf`；不可用时回退内置 `libreoffice-kit`。
- **一键导出全部书籍（R35 ②）**：设置 →「导出与文件」里的一行按钮，把每部作品按**同一格式**各导一份、
  打成一个 zip 下载（`精神空间-全部作品-YYYYMMDD-HHmm.zip`）。整批一次算完再打包，不逐本弹下载框；
  **重名不覆盖**（第二本同名自动变成 `书名 (2).docx`，zip 里同路径只能留一个），
  **单本失败不拖垮整批**（收进 `failed` 数组，最后 toast 报「已导出 N 部，M 部失败」）。
  单本导出与全量导出在 Host 侧共用 `buildBookFile()`，所以格式、追加内容、封面这些选项完全一致。
- **文末追加固定内容**：设置 →「写作」里写一段「文末追加内容」并开「导出时追加」，或在导出对话框里对单次导出临时更改。
  内容 ≤ 8000 字，Host 侧按格式插入（docx 独立段落 / epub 新增 `<p>` / txt 末尾空行后）。
- 导出选项：封面、章节间分页、生成目录、包含书名与作者；「包含书名与作者」的默认值在设置里。

### AI 校对与一键排版
- 可选任意 Harness 已配置 provider 与模型（`llm.listProviders()` + `listModels()`，默认取当前 agent 默认模型）。
  下拉永远有选项：若当前默认模型不在 `listModels()` 返回里（部分 provider 不暴露列表），会把它作为「（当前默认）」补进第一项。
- 校对按 4000 字分块串行请求，定位方式为「模型返回原文 → `indexOf` 对齐 + 块偏移」，并用 `text.slice(start,end)===original` 二次校验，对不齐的建议直接丢弃。
- **模型失败自动回退（R34）**：一次校对按「设置里选的模型 → Harness 当前默认 → 列表其余」逐个尝试，
  只有全部失败才停。中途失败会在面板上写一行「换用 X 重试…」，最终换了模型时提示「原模型没有响应，已改用 X」，
  并把实际使用的模型记进结果（`usedModel` / `failovers`）。用户主动取消（`err.code === 'aborted'`）**不会**
  触发换模型——取消是意图，不是故障。修改建议栏与投稿助手共用同一套逻辑。
- **注意**：`llm.stream()` 不能传顶层 `system` 字段（宿主 pi 适配器会对字符串 `content` 调 `.some(...)` 崩溃）。本插件把系统提示词折进 user 消息的 text block。
- 建议逐条勾选，支持单条接受 / 拒绝 / 全部接受 / 全部拒绝；**先预览 diff 再应用**，`applyEdits` 从右往左写入，不覆盖未接受的原文。
- 一键排版：统一省略号与破折号、中英文标点、引号、段落两字全角缩进、空行折叠、章节标题格式、对话分段。同样先出 diff 预览，`changed === 0` 时禁用应用。

### 修改建议栏（R12 ② 新增）
右下坞 `✦ 修改建议` 打开一块**与正文左右并列**的评论栏（`NW.Advice`，默认宽 336px，可拖宽 260–600px，
开关与宽度都记在 `localStorage`）。它不是替换工具，而是「第二读者」：

- 点「开始审读」后，Host 把当前章按 4000 字分块送模型（`lib/ai.js` 的 `revise()`），要求返回
  `{quote, issue, advice, kind}` 四元组，`kind` 限 节奏 / 用词 / 视角 / 画面 / 对话 五类，每章最多 8 条。
- 面板顶部一排「重点」分段控件（全部 / 节奏 / 用词 / 视角 / 画面 / 对话），换重点会重新审读。
- 每条建议显示「原句 → 问题 → 怎么改」；**点一条会把编辑器滚到那一段并高亮**（`setHighlights`），
  面板底部有「重新审读」与「取消高亮」。切章自动清空，避免建议引用屏幕上已经不在的文字。
- **对照阅读（R23）**：打开建议栏会**自动收起左侧目录**——三栏并排时纸只剩 ~550px，建议与原文就会变成
  上下堆叠；关掉建议栏时**只在原本是打开的情况下**恢复目录，不会把用户手动隐藏的目录又翻出来。
  点一条建议时，原文那句由新 API `centerRange(start, end)` **精确滚到屏幕上下中间**（不再用比例近似），
  建议卡也滚到同一条水平带（实测两条中线差 0–20px）。
- **自动宽度（R25）**：栏宽不再是固定的 336px，而是 `flex:1 1 300px` 吃掉正文用不完的宽度、**紧贴纸面**
  （宽屏实测 560px，只剩页边距 16px 的死白）；同时纸面停止生长、钉在设定页宽，两块作为整体居中。
  拖左边缘的把手可手动定宽（300–640px），**双击或按 Home 回到自动**；自动模式的 560px 上限不会钳制
  手动宽度（`.nw-suggest[data-manual="1"]` 把上限放到 640px），否则拖过 560 会看起来毫无反应。
  窄面板（≤780px）下自动宽度收到 `min(320px,42%)`，不抢正文。
- **双向同色下划线（R23）**：建议卡里的引用不再用左侧竖条，改成 2px 品牌色下划线；原文对应句同步换成
  同一根下划线（底色从 55% 降到 30%，保证字读得清）。两边都取 `--nw-brand` 而不是宿主 alias，避免色差。
- 定位方式与校对一致：模型给的 `quote` 用 `indexOf` 回原文对齐，对不齐的条目标「原文已改动，定位不到」，
  仍然显示意见但不做高亮——宁可少给一次跳转，也不跳到错的段落。
- **模型回退（R34）**：与校对同一条路径（`NW.ai.reviseSafe`）。审读失败先自动换候选模型重试，全失败才在栏内
  弹「换个模型重试」选择器；错误直接显示在栏里，不会每失败一次就弹一次 toast。

### 投稿助手（R8 三步 + 智能推荐，R12 直达预览）
右下坞 `✉ 投稿` 打开三步向导（`NW.dialogs.Submit`，宽 820px）：**先选小说 → 再选期刊 → 邮件预览**。
选定期刊点「下一步」就直接落到预览页：进入第 3 步的 effect 会立刻跑 `submit.prepare`，
模型按该刊征稿要求写好收件人、主题、正文与附件，作者只需要**审阅并改**，不用再点「生成」。

1. **① 选小说**：小说列表（默认选中当前正在写的那本），右侧列出各章字数；可按「整本 / 当前章 / 自定义勾选章节」定稿。
   换了小说，体裁推荐与邮箱判定都会跟着重算。
2. **② 选期刊**：期刊库 **79 家**（人民文学 / 收获 / 十月 / 花城 / 当代 / 钟山 / 作家 / 上海文学 / 天涯 /
   长江文艺 / 山花 / 芙蓉 / 江南 / 清明 / 北京文学 / 萌芽 / 西湖 …），其中 **58 家带公开收录的投稿邮箱**。
   顶部一条**智能推荐**（最多 6 家）。**R27 ③ 起这条推荐由大模型判断**，不再是算术打分：
   - Host 先用规则排序筛出 12–30 家的候选清单，再把**稿件开头 2400 字**连同每家的体裁、字数区间、
     标签、征稿要求一起交给模型；模型逐家给出 `fit`（0–100）、一句 `verdict`、两三句 `reason`，
     以及 `quality`（**够格 / 略欠 / 尚不足**）。
   - 判断依据按重要性排序：题材与趣味 → 篇幅 → 水准（以该刊层级衡量）→ 栏目；提示词里明确写了
     「不要因为有邮箱、字数够就给高分」和「水准不足就如实说不足」。所以它敢说「这稿还不够格」——
     规则打分永远说不出口。
   - 卡面标题会如实写**「大模型读过开头，按契合度与水准推荐」**；模型不可用时自动退回规则排序，
     标题改回「为你推荐（按字数、体裁与题材匹配）」并附一句原因，**投稿流程不会因此中断**。
   - 每行显示期刊名 + 一枚质量徽章，下面一行是模型给的理由。规则分仍保留在返回体的 `rules` 字段里，
     只是不再主导排序。
   - 右侧详情同时列出**该刊登记的全部收稿邮箱**，命中的那一条标「本稿用这个」并带 `data-on` 高亮。
   **R16 起每行还带一枚期刊等级徽章**（国家级 / 省级 / 市级 / 其他），详情面板第一行就是「期刊等级」，
   作者判断投稿难度时不用再自己去查。等级由标签推导，属于粗略参考，具体以期刊官方说明为准。
   **全部邮箱 `verified:false`**，界面上标「待核对」——请以期刊官方最新征稿启事为准。
3. **③ 邮件预览**：`submit.prepare` 由 Host 生成主题与正文、把稿件调整成期刊要求的格式，
   返回 `changes`（章标题 / 空行 / 标点 / 缩进逐条说明）与 `attachments`（按期刊要求生成的附件）。
   **收件人、主题、正文、附件名、署名全部可在这里改**，附件行给出「预览 / 下载 / 移除」，
   点「查看全文」以只读层展示完整邮件（不截断）。**这一步不会发信。**
4. 点「确认投稿」才真正 `submit.send`，随后写一条投稿记录（`submissions.json`，最近 50 条）。

- **邮件正文不复述征稿要求**（R11）：遵守要求体现在信本身（主题格式、附件数量与命名、是否粘贴正文），
  在正文里逐条抄录「贵刊要求：1…2…3…」会像模板群发，编辑一眼就能看出来。R11 删掉了
  `handleSubmitPrepare` 里「模型漏了哪条就补一条进正文」的逻辑，也把兜底信的
  「贵刊的征稿要求我已逐条对照」改写成一句「投稿前已按贵刊要求核对格式与字数」；
  `SUBMIT_SYSTEM_PROMPT` 里也加了一条硬约束禁止复述。
- **投稿附件是「稿件」而不是网页导出**（R10）：docx 走 `manuscript` 模式——页眉右对齐 `书名　·　作者：X`（楷体 9pt 灰）、
  正文行距放宽到 1.75 倍并在每章前分页，方便审稿人直接在纸上批注；附件行可下载与编辑部完全一致的字节。
- **安全阀**：只有 ≤ 4000 字才把正文交给模型调整；返回的章数必须一致、每章长度在 0.7×–1.4× 之间，否则丢弃改回纯规则排版；AI 不可用时自动退回规则排版并给出 warning。
- 未配置 SMTP 时点「确认投稿」会留在原页并提示「去配置邮箱」，不会真的发信失败。
- **模型回退（R34）**：`submit.prepare` 失败后会依次换模型重试（顺序同校对），全部失败时弹选择器让你指定
  一个模型再试；选择器标题是「AI 投稿」，逐条列出失败原因（最多 6 条）。

### 投稿管理（R5 新增）
`NW.dialogs.SubmitManager`，入口在首页顶部的「投稿管理」按钮（R35 ③ 之前是页脚的「快捷入口」卡）。
按状态筛选（全部 / 已投稿 / 等待回复 / 已过稿 / 已退稿 / 已发表 / 已撤回），每行显示
**小说名 · 期刊 · 投稿日期 · 距今 N 天 · 状态徽章**，可原地改状态（`submit.update`，原子重写 `submissions.json`），
也可「重新投稿」——回填该期刊重新打开向导第 1 步。状态是本机记账，不会联网、不解析回信。

### 期刊库（R5 新增，R11 支持增删改查）
`NW.dialogs.Journals`，入口在首页顶部的「期刊库」按钮（R35 ③ 之前是页脚的「快捷入口」卡）。
79 行列表 + 搜索 + 「只看待核对」；每行显示名称、邮箱（未收录则写「未收录邮箱」）、字数区间与「已核对 / 待核对」徽章；
行内编辑邮箱 / 官网 / 字数区间 / 要求，保存时只写 delta，填了邮箱会自动置 `verified:true`。
内置条目的 `tags / subject 模板 / attachments / paperOnly / responseDays / minWords / maxWords` 也一并落库。

**R11 补齐了「增」和「删」**：
- **新增**：工具栏「新增期刊」→ 先填期刊名（其余字段同编辑表单），保存时由 `lib/journals.js` 的 `makeId()` 按名称生成 slug（重名自动加 `-2`），整条作为自定义条目落库。
- **删除**：行内「删除」按钮或编辑表单底部「删除这家期刊」，二次确认后写**墓碑**（`{id, deleted:true}`）。
  墓碑是必须的 —— 内置 79 家来自代码里的 `TABLE`，如果只是从 overrides 里移除，下一次 `merge()` 会把它们**复活**，
  用户会看到「删了又回来」。
- **改 / 查**：原有能力不变；自定义条目可改全部字段，内置条目只存与内置值不同的字段（`diffFromBuiltin`）。
- 多邮箱仍按「期刊 + 体裁 / 字数区间」分列，编辑器里一行一条：`邮箱 | 体裁 | 字数 | 备注`。

**R16 新增水平等级**：每家期刊多一个 `tier`，取值 `national` / `provincial` / `municipal` / `other`
（国家级 / 省级 / 市级 / 其他）。**它不是新加的数据列** —— 79 行内置表每行 12 个位置参数，再加一列既容易漏又难维护，
所以 `tier` 由原有的「国家级 / 省级 / 市级」标签推导（`tierOfTags()`），没标签的一律算「其他」。
当前分布：国家级 6 家、省级 33 家、市级 19 家、其他 10 家。用户仍可在编辑表单里逐刊覆盖（`diffFromBuiltin`
只持久化真正改过的值，否则会把本应跟随标签的推导值冻结住）。
投稿向导里，期刊列表每行带一枚等级徽章，详情面板第一行就是「期刊等级」—— 作者判断一家刊最容易看的就是这个。

### 数据与隐私
IndexedDB `novel-writer` v2：`novels` / `chapters` / `versions` / `trash` / `settings` / `notes`（R10 新增灵感便签）。
- 自动保存 + 每章保留最近 50 个版本快照（60s 节流 + 手动「立即快照」）。
- 删除进回收站，可单条恢复或清空；删除小说连带其章节与版本。
- 备份：本地 JSON 全量导出 / 恢复（单事务 `clear + put`，失败回滚），恢复后编辑器自动重新载入。

**锁定与加密（两层）**：
- 浏览器内：PBKDF2-SHA256（210000 次）派生密钥，正文以 AES-256-GCM 逐段加密落盘（`enc:v1:` 前缀）。
- 有密码 + 冷密钥（刷新 / 重启 DSH）= 强制锁定，**不信任 localStorage 的解锁标记**。
- 存在密码但密钥已冷时，`saveChapterContent` 拒绝任何对密文的覆盖（明文、空串都拒），杜绝「解密失败 → 空串回写 → 正文永久清空」。
- 改密码 / 清密码前先 `decryptAll()` 用旧密钥还原，再重新加密或明文落盘；**改密码必须先验旧密码**（`NW.crypto.changePassword(old,next)`），旧密码错则零状态变更。设置面板是「当前密码 / 新密码 / 清除密码」三个独立输入框。
- 离开超时自动锁定（默认 15 分钟）、`Ctrl+Shift+L` 手动锁定。
- **磁盘镜像加密**：设置 →「自动保存与恢复」里打开「加密保存」，`library.mirror` 会写 `<书名>.docx.nwe` + `library.json.nwe`，
  格式 `NWENC1` + base64(`iv[12] || tag[16] || ciphertext`)，AES-256-GCM，密钥由 Host `secrets/key.bin` 经 **HKDF-SHA256**（info `novel-writer-mirror`）派生——派生密钥不落盘。
  **R16** 起文件格式**只有 `.nwe` 一种**：明文副本的开关、按钮与文案已全部移除（R15 的 `plain` 设置位也从
  `settings.json` 里清掉），需要临时导出可读副本时仍在 `<dir>/plain/` 下操作（`library.decryptTo`）。
- **同步缓存也加密（R36）**：`DSH_HOME/novel-writer/sync-state.json` 是手机同步的权威副本，过去是明文 JSON，
  开着正文加密时等于把解密后的书稿摊在磁盘上；现在写成同一个 `NWENC1` 容器（同一把派生密钥），
  旧明文文件仍能读、读不出来时退化成空库（浏览器下一次 push 会重建）。

**小说保存目录**：设置 →「导出与文件」里的入口打开「自动保存与恢复」面板，选一个本机文件夹（Windows 原生目录选择器，也可手输路径），
之后每次修改自动把每部小说覆盖成 `<书名>.docx`（加密时 `.docx.nwe`）+ 一份 `library.json` 全量快照。
路径与开关存在 `DSH_HOME/novel-writer/settings.json`（原子写）。

**密钥与 API Key**：Host 侧 `DSH_HOME/novel-writer/secrets/`，`key.bin`（32B，尝试 0600）+ `store.enc`（AES-256-GCM 信封），原子写入、写操作串行化、铸钥单飞，绝不硬编码、绝不明文落盘。

### 设置（左右两栏 · 七个分区）
左侧导航 + 右侧内容，右栏单独滚动（`max-height:min(62vh,560px)`），窗口 <640px 时导航折成可换行的胶囊行：
1. **外观**：九套主题色块、字体、字号、行距、页宽、打字机模式、沉浸模式。
2. **写作**：**统计字数包含标点符号**（R16 ⑥，默认开）、自动保存间隔、默认导出格式、文末追加内容与开关、导出包含书名与作者、封面入口、校对默认模型。
3. **导出与文件**：默认格式、**一键导出全部书籍**（R35 ②：每部作品一个文件、打成一个 zip，跟着默认格式走）、
   版本历史，以及**一行的「自动保存与恢复」摘要 + 打开按钮**（R10 去重：具体控件只在那一个面板里）。
4. **隐私与锁定**：自动锁定、锁定超时、正文加密存储、密码设置 / 修改 / 清除。
5. **投稿**：**服务商预设胶囊**（QQ / 163 / 126 / Yeah / 新浪 / 阿里 / Gmail / Outlook / iCloud，一键填主机 + 端口 + SSL）、
   SMTP 主机 / 端口 / TLS / 用户名 / 密码 / 保存 / 测试连接；默认笔名、联系方式、回信邮箱；期刊库入口。
6. **手机同步**（R34 / R38）：**配对面板就地展开**（R38 ②，不再另开窗口）——「电脑地址」「配对码」两行字、
   倒计时、「复制这两行」、「生成 / 重新生成配对码」、已配对设备列表与「解除」，全部在这个分区里完成；
   分区一出现就**自动取码**（没有有效配对码才生成新的，仍在 5 分钟内则复用它），所以打开设置就能直接读到
   地址与配对码，不必先点按钮（R38 修正：内联后曾经先显示空面板，要再点一次才出码）；
   **同步状态**（R38 ①）优先显示 `lastSyncAt`（最近一次同步，含手机推上来的那次），没有才回落到桌面自己的
   推送 / 拉取时间，再没有就是「还没有同步过」；**局域网地址**（LAN 监听真的在跑时才逐条列出
   `http://192.168.x.x:41288`，否则写「未启动（生成配对码时会自动启动）」）。
7. **快捷键**：完整键位表。

### 手机同步与手机 App（R34）

同一 Wi-Fi 下的手机可以直接翻、改你的小说。桌面是数据的家，手机只是第二块屏幕：**没有云端、没有中继、
没有账号**——配对一次，两边各存一份，见面时互相合并。

**为什么插件里要多开一个服务器**：`dsh web` 把插件路由绑在 **127.0.0.1** 上，这是宿主的默认行为，
不是本插件的选择，所以手机把同一套 API 打到局域网地址上必然超时（配对接口在浏览器里 200、在手机上超时，
这一点用 netstat 核对过）。R34 因此新增 `lib/lansync-server.js`：在 `0.0.0.0` 上开一个**刻意很小**的
HTTP 服务（默认端口 **41288**，可用 `lan.start {port}` 换端口），只有四类路径——`ping` / `pair/handshake` /
`pair/accept` / `sync`。配对路径靠一次性 token，同步路径靠配对时下发的共享密钥签名；**没有文件访问、
没有设置、没有 AI**——一个被攻破的 LAN 端口最多也只能搬书。

**配对（只需一次）**
1. 打开设置 →「手机同步」分区。面板一出现就**自动取一次配对码**（`pair.status` 里还有未过期的就复用，
   否则 `pair.start` 生成新的），桌面此时**顺便把 LAN 监听拉起来**（幂等，已启动就复用）。
2. 面板最上面直接印出**两行字**：「电脑地址」`192.168.x.x:41288` 与「配对码」`3xKq9ploB2Z1`（12 位），
   下面还有一枚「复制这两行」按钮。**端口是 LAN 监听端口，不是 DSH 的 Web 端口**（R34 修掉的 bug 就是把
   UDP 发现端口 41287 写进了这里）。
3. 手机打开「精神空间」→「配对」（这是 App 的默认入口），把这两行填进去，点「配对」。只填 IP 也认，
   端口默认 41288；把桌面的整行 `nw1:host:port:token` 粘进地址栏也认，手机自己会拆。
4. 手机随后 `pair.handshake` 用 token 换取桌面的 id 与 **Ed25519 公钥**（桌面先证明自己：
   token 是唯一只能来自「看过这块屏幕」的凭据）→ `pair.accept` 手机再自报身份 → 桌面记下 peer 与共享密钥。
5. 配对码 **5 分钟**过期（面板里是倒计时，不是进度条），过期重新生成即可。抄错或过期手机端会明确说
   「配对码不对，或者已经过期」；连不上则说「确认手机和电脑连的是同一个 Wi-Fi」。
6. 已配对设备在面板底部逐行列名，可「解除配对」；解除后该设备必须重新配对，桌面不再向它吐任何数据。

**扫码（备选）**：面板下方仍然画着二维码（内容就是 `nw1:host:port:token`），手机「配对」页底部有
「改成扫码」可以对着扫。**R34 收尾时修掉了扫码的 bug**：手机原本只认 `nw-pair://?tok=…` 这种谁也没产出的 URI，
于是每次扫码都解码成功却回一句「这个二维码不是精神空间的配对码」——现在 `nw1:` 前缀是首选格式。
即便这样，手填仍是默认路径：二维码在这类深色面板上对焦不稳，而两行字永远读得出来。

**取景（R35 ①）**：扫码页的预览原先从来没有设过朝向——相机传感器是横向的，竖着拿手机时
`SurfaceView` 把横向画面直接铺进竖屏，于是看到的是**旋了 90° 又被拉伸**的图像，取景框里的二维码
自然对不上、一直解不出来。现在 `ScanActivity` 按 `CameraInfo.orientation` 与当前屏幕旋转算角度，
在 `surfaceCreated` / `surfaceChanged` 里都调 `setDisplayOrientation()`（配对途中转动手机也会重新摆正），
预览尺寸也从 `getSupportedPreviewSizes()` 里挑最接近 16:9 的一档，而不是硬要 1280×720
（设备不支持时 `setParameters` 会抛异常、静默退回默认尺寸，画面比例随之走形）。
解码再加一层保险：第一帧没命中就把图像转 90°/180°/270° 各试一次，横竖怎么拿都能扫。

**发现（可选，手填与扫码都不依赖它）**：桌面同时用 UDP **41287** 广播 `nw-lansync/1` 信标（`lansync.startDiscovery`），
手机端 `Discovery.java` 收到后可自动填地址。`pair.info` 现在分别返回 **`port`**（手机该连的 LAN 端口）与
**`discoveryPort`**（41287，只用于广播），两者不再混用。

**同步怎么合并**：单位是「书」——`{id, title, author, updatedAt, deleted, chapters}`。
- 浏览器 IndexedDB 是正本；书单或章节一变，`sync.push` 就把**整库**交给宿主镜像（宿主读不到 IndexedDB，
  不推就永远没有可同步的数据）。推送有 2 秒防抖，且**锁定时不推**。
- 手机推 / 拉都走 LAN 监听 → 宿主镜像 → 浏览器。浏览器每 **6 秒** `sync.pull` 一次，**只应用**
  「远端 `updatedAt` 严格更新」或「远端说删了而本地还有」的书——不这么做的话，30 本书的库每 6 秒全量重写一遍，
  光标底下的正文会被当成「外部改过」。
- 合并规则（`lib/lansync.js` 的 `mergeLibraries`，注释就写在函数上方）：
  1. 只有一边有的书**照单收下**（墓碑也算——手机上删的书必须落到桌面）；
  2. 一边墓碑、一边活的 → **时间新的赢**；同一毫秒打平则**活的赢**（删除与编辑撞在同一毫秒时不能悄悄吃掉编辑）；
  3. 两边都活 → `updatedAt` 新的**整本**赢；
  4. 完全打平 → 本地赢，保证反复合并稳定、不来回振荡。
- **墓碑**：删书进回收站，`trash` 里 `kind === 'novel'` 的条目会被 `syncLibrary()` 派生成
  `{deleted:true, updatedAt: deletedAt}` 的墓碑。没有它，手机在删除期间离线、下次回来会把旧书原样推回来。
  R34 修的另一处 bug 正是「墓碑与活本比较时把胜负写反」，删除后又编辑的书因此永远复活不了。
- 手机上删书同样写墓碑（`MainActivity` 删除确认里就是这条注释），所以「手机上删 → 桌面也删」是单向可信的。

**手机端能做什么**（`app/`，手写 Java，只有扫码用 ZXing）：书架（新建 / 重命名 / 删除书）、
点进一本书看章列表（新建 / 重命名 / 删除 / 编辑正文，纯文本）、手动「同步」、配对（**默认手填地址 + 配对码**，
可切「改成扫码」）与解除配对；`SyncService` + `BootReceiver` 做后台同步（需要通知权限，拒绝时仍可手动同步）。

**手机端的阅读与同步体验（R38）**
- **字号可调**：编辑器 header 的 **A- / A+** 每按一次走 1 号（14–34，默认 19），写进 `SharedPreferences`，
  下次打开还是这个字号；行距按字号的 0.5 倍算，大字号不会挤成墙、小字号不会飘。
- **长章输入不再掉队**：过去每敲一个字符就要整章 `toString()` + 一次去空白正则（3 万字的章等于每键几 MB 的
  临时字符串），现在字数在停手 260ms 后读一次输入框，保存仍在停手 1.2s 后整库落盘（见已知限制 41）。
- **每本书带同步标记**：书脊下方显示「已同步」/「有改动待同步」/「还没有同步过」。判定是
  `Store` 里记的 `bookId → updatedAt` 与这本书当前的 `updatedAt` 是否相等 —— 同步成功后 `SyncEngine` 把
  每本书的版本盖一次章，之后任何本地改动都会把这本书推进「待同步」。
- **白天 / 黑夜**：书架、章列表、编辑器、配对页 header 都有 ☀ / ☾（`Skin.java`），切换后 `recreate()` 立即
  换配色，状态栏与导航栏图标跟着反色；`res/values-night/` 里是一套独立的深色（纸 #171512 / 墨 #ece4d6 /
  陶土 #e2794f）。不用 AppCompatDelegate：工程没有 AndroidX，单 dex 塞不进它。

**安全边界**：配对 token 一次性且 5 分钟过期；同步请求带设备 id + 共享密钥签名，未配对设备读不到任何东西；
LAN 端口是**明文 HTTP、无 TLS**，默认只在同一 Wi-Fi 内可达。**不要把 41288 端口映射到公网**。
**和「正文加密存储」怎么共存**：手机没有密钥，也永远不会拿到（配对只下发共享密钥，不是加密口令），
所以桌面在 `sync.push` 之前把正文解密，手机收到的就是纯文本；手机推回来的改动在写回 IndexedDB 时
按当前加密状态重新加密（`sealContent()`），加密库里不会多出一条明文行。宿主侧的同步缓存
`sync-state.json` 用本机密钥加密存放（`NWENC1`），推明文不会顺带把磁盘上的缓存变成明文。
**手机端是明文存储**：SharedPreferences 里的书稿没有加密，手机丢了等于书稿丢了，这一点别指望加密能救。

**APK**
- 产物：`dist/精神空间.apk`（**545577 B ≈ 0.52 MB**；另有 `.idsig`）。package `com.novelwriter.app`，
  versionCode 1 / versionName 1.0.0，minSdk **24（Android 7.0）**、target 34；权限只有
  `INTERNET` / `ACCESS_NETWORK_STATE` / `ACCESS_WIFI_STATE` / `CAMERA`（扫码）/ `POST_NOTIFICATIONS`。
- 安装：把 APK 拷到手机点开，按提示允许「安装未知来源应用」；**直接覆盖安装即可升级**，
  签名用的是固定的 debug keystore（`storepass`/`keypass` 都是 `android`，别名 `novelwriter`），
  换签名会导致必须先卸载、配对信息随之丢失。
- 构建：`node tools/build-apk.mjs`（**不用 Gradle**：aapt2 编译资源 → javac 编译 Java → d8 出
  `classes.dex` → zipalign → apksigner 签名，dex 用 `tools/zip-append.mjs` 的 `ZipArchive.append`
  塞回 APK）。工具链在 `.tools/android/`（build-tools 34.0.0、platform android-34、便携 JDK），
  缺失时可跑 `tools/setup-android.ps1` 下载；ZXing 必须作为 **program input** 交给 d8，写成 `--lib`
  会在运行时 `NoClassDefFoundError`。

### 自动保存与恢复（R9/R10：本地文件夹 + 加密，云备份已删除）
- **云备份整块删除**：`lib/cloud.js`、`NW.cloud`、备份面板的 WebDAV / Gist / 文件夹三种后端全部移除。
  开启自动保存之后，小说本来就在你自己的硬盘上，再叠一层云端同步只是把同一份数据复制到别人的服务器。
- **只有一个入口，不再重复**（R10）：设置里的「导出与文件」只留一行摘要 + 一个「打开…」按钮，
  选目录 / 开关 / 保存 / 恢复全部收在 `NW.dialogs.Backup` 这一个面板里（标题「自动保存与恢复」）。
- **选一个文件夹，之后每次改动自动覆盖写入**：`library.pick()` 打开 Windows 原生目录选择器
  （回退到宿主 `uiWorkspace.pickDirectory()`），选定即视为开启自动保存。
- **落盘格式是 Word**（R10）：`<书名>.docx`（加密时 `<书名>.docx.nwe`）——A4、宋体 14pt、首行缩进、每章分页，
  编辑和审稿人双击就能打开；早期版本写的 `.md` 仍然能被列出与解密，只是不再新写。
- **默认加密**：写盘的是 `NWENC1` + base64(`iv[12] || tag[16] || ciphertext`)，AES-256-GCM，
  密钥由宿主 `secrets` 里的 `key.bin` 经 HKDF-SHA256 派生（info `novel-writer-mirror`）。密钥只在本机，拷走文件夹的人打不开。
- **快照是完整的**：`library.json[.nwe]` 里同时带 `novels` / `chapters` / `settings`，
  所以「从文件夹恢复」和「从单个备份文件恢复」都能还原书目 + 正文 + 偏好设置，而不只是书名列表。
- **两种恢复入口**：面板里的「从上面这个文件夹恢复…」，以及「从备份文件恢复」——后者接受任意
  `.nwe` / `.json`，客户端读成文本交给宿主 `library.restore({text, name})` 解密，不要求文件在保存目录里。
- **为什么要加密**：自动保存写出去的是**加密的** `.docx.nwe`（`NWENC1` 容器，AES-256-GCM），
  直接双击打不开 —— 这是有意的，别人拷走你的文件夹也读不到正文。
  宿主侧仍保留 `library.decryptTo`，能把整目录的 `.nwe` 还原成可读的 `书名.docx` + `library.json`
  并输出到 `<保存目录>/plain/`；**R16 起界面上不再有这个按钮**（用户要求「文件格式只留 `.nwe`」），
  需要临时导出可读副本时得直接调这个接口。
- **R16：只保留 `.nwe` 一种格式**。上一轮（R15）曾有一个「同时保存一份明文 .docx」开关，让每次保存顺手
  写一份可读副本；这个开关和它的按钮、状态文案在 R16 全部移除了，`settings.json` 里的 `plain` 字段也一并
  清掉。理由：两种文件并存在磁盘上既容易混淆，也让「加密」名不副实。

### 灵感便签（R13 悬浮卡片，R14 自动保存且按章独立，R16 去边框，R24 移到左侧，R27 可点收起）
写作页**左上角**常驻一枚小胶囊（`✦ 灵感`），点开后是**一张悬浮卡片**，不是整页、也不分窗口：
- **位置（R24 起在左侧）**：`top:52px; left:14px`，宽 `min(320px, calc(100% - 28px))`。
  卡片打开时写作列给它让出 **348px 车道**（`data-notes-lane="1"`），正文从车道右侧开始，
  **不会被盖住**；关掉卡片车道立即释放。车道按 **`.nw-bench` 容器宽度**预算，bench ≤ 820px 时自动取消。
- **点击收起、不点保持（R27 ②）**：胶囊文字随状态切换 —— 收起时是「灵感」、展开时是「收起」，
  不透明度 0.72（hover 到 1）。展开状态写进 `localStorage`（`nw.notesOpen`），**刷新或重开仍是你上次的选择**，
  不会自己弹开或自己收起。卡片右上角另有一枚 ✕（hover / focus 才显形），两处都能折叠。
- **为什么不会和角落按钮打架（R27 ①）**：首页 / 目录 / 锁定三个按钮锚在 `.nw-surface` 的左缘。
  车道如果做成写作列的 `padding-left`，surface 会被整体推走 348px，按钮跟着扑到纸上；
  现在车道加在 `.nw-surface` **自己**的 `padding-left` 上 —— surface 仍占满整列、左缘不动，
  滚动区与纸面从车道结束处开始，按钮因此永远钉在 `{x:294,y:10}`（实测开关两态完全一致）。
- **无边框（R16 ④）**：卡片里**没有头栏也没有底栏**，只有纸和字。状态字（未保存 / 已保存 / 空白）与收起按钮
  收进 `.nw-notes-tools` 浮层，默认 `opacity:0`，hover 或 focus 才出现 —— 打字时不会有两行装饰在晃。
- **自动保存（R14 ③）**：停止输入 600ms 即写回，失焦或 `Esc` 立即落盘 —— 没有保存按钮，也不用记快捷键。
  `Enter` 恢复为普通换行。
- **自动拉高（R14 ③）**：输入框高度跟随 `scrollHeight` 增长（上限 420px），文字多了卡片自己变高，
  不再固定 96px 内滚动。
- **一章一份（R14 ③）**：便签按 `chapterId` 存（IndexedDB `notes` store 的一个字段），切章即换内容，
  互不影响；清空输入框会删掉该章的记录，不会留一张空卡。
- 卡片挂在 `.nw-bench-paper` 内而不是整个写作列，这样修改建议栏展开时它不会漂到建议上面去。
  沉浸模式下不渲染（沉浸是纯写作画布）。

### 收件箱（R9，R11 修 163/126，R12 可点开读，R16 可删）
- 首页右上「收件箱」卡片读收件箱最近 12 封，显示发件人 / 主题 / 摘要 / 未读点；`inbox.list` 是真实 IMAP 往返。
  列表**每类最多 3 条**（R16 ⑤），超出折叠成「展开全部 N 条」。
- **删除（R16 ⑤）**：每行右侧一个垃圾桶键（默认 `opacity:0`，hover / focus 才出现，放在阅读按钮**外面**，
  误点不会打开邮件）。走 `inbox.delete` → `UID STORE +FLAGS (\Deleted)`，再优先 `UID EXPUNGE <uid>`
  （RFC 4315，只清这一封），服务器不支持时回落整箱 `EXPUNGE`；两步都失败则返回 `expunged:false`，
  界面提示「服务器只把邮件标记为已删除，需要在你自己的邮箱里再清一次」。删除前有确认框。
- **点开读全文（R12 ④）**：列表行是真正的按钮（hover 出 `›`），点开走 `inbox.read` 取完整正文。
  宿主用 `UID FETCH <uid> (FLAGS BODY.PEEK[])` 取正文，**取到之后再补一条 `UID STORE <uid> +FLAGS (\Seen)`**
  —— 先读后标，所以标记失败也不会吞掉信件；`options.markSeen === false` 可以只读不标（R14 ②）。
  正文解码链：`splitMessage` → 各段 `Content-Transfer-Encoding`（base64 / QP）→
  `charset`（UTF-8 / GBK / Big5）→ `htmlToText`；`text/plain` 优先，只有 HTML 时才转纯文本。
  读信弹窗（`NW.dialogs.Mail`，760px）把正文放 `<pre>`：投稿回信会逐字引用稿件，重排会破坏编辑所指的换行。
  读完后首页的「未读」会刷新 —— 邮件已被服务器标为已读，卡片上那个点会消失。
- 零依赖 IMAP 客户端 `lib/imap.js`（只用 `node:net` / `node:tls`）：993 直连 TLS，143 强制 STARTTLS；
  自签证书先记录 `certBypassed` 再降级（与 SMTP 同一套错误码与中文提示）。
- **默认沿用发信账号**：`useSmtp` 为真且没填主机时，把 `smtp.qq.com` 推成 `imap.qq.com`、`smtp-mail.*` 推成 `imap-mail.*`，
  大多数作者只有一个邮箱，不必再学一套服务器地址。
- **「已关闭」与「连不上」分开显示**：`enabled:false` 时宿主根本不发 IMAP 请求，首页说「收件箱已关闭」并给去设置的入口；
  认证失败则原样显示服务器返回的那句话 + 授权码建议，绝不把失败画成「没有回信」。
- **网易 `Unsafe Login`（R11 修复）**：163 / 126 会拒绝没有声明客户端身份的会话 ——
  `LOGIN` 成功之后 `SELECT INBOX` 直接回 `NO SELECT Unsafe Login. Please contact kefu@188.com for help`。
  旧代码把这段文本里的 `login` 匹配成「认证失败」，把人引去查密码，方向完全错了。
  现在 `Session.identify()` 在 `LOGIN` 之后、任何 `SELECT` 之前发送 RFC 2971 的
  `ID ("name" "novel-writer" "version" "1.2.0" …)`；命令失败只记 `idStatus` 不抛（ID 是可选命令），
  但 `command()` 里新增了 `unsafe login` 的专门分支，命中时返回 `imap-id-required` 而不是 `imap-auth-failed`，
  提示语也改成「这是网易对未声明身份客户端的封锁，插件已自动握手；仍失败请把本客户端加入白名单或改用 QQ / Gmail」。

### 邮件服务器自愈（R5）
`lib/smtp.js` 的 `diagnose()` 在「测试连接」时按 **(465 SSL) → (587 STARTTLS) → (25 明文)** 顺序试三种形态，
一处连不通自动换下一个；遇到认证失败立刻停（端口已通，换端口没用）。失败信息统一过 `hintFor()` 翻译成可操作建议
（「多数邮箱不允许用登录密码发信：请先在网页端开启 SMTP，再用生成的授权码」等），并把尝试矩阵回传成
「已尝试 SSL 465✗ / STARTTLS 587✓」显示在设置里。

## 3. 验收状态

> **第三十八轮（R38）**：桌面「上次同步」显示、配对面板内联、手机字号与卡顿、书级同步标记、白天黑夜主题。
> 按要求仍不做真机回归，只跑离线脚本、语法、客户端构建与 APK 重打：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check` 全量（`lib/*.js` / `client/src/*.js` / `scripts/*.mjs`） | 除 `00-boot.js`、`99-end.js`（bundle 包裹片段，天生不能单独 parse）外全部 exit 0 |
> | **宿主离线测试** | `node scripts/verify-host.mjs` | **174 项，失败 0**（`peerSyncSummary` 只在 LAN 端点与 `peer.apply` 里写入，未加新用例） |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts → 916180 字节**，`verify-client-load: ok` |
> | 语言表 | 扫本轮新增中文串对 EN 词典 | 新增 6 条（`最近一次同步 {0}`、`配对码 {0} 秒后失效`、`未命名设备`、`解除`、`正在读取…`、`最近一次收到手机改动 {0}`）已补 |
> | **APK 重打** | `node tools/build-apk.mjs` | aapt2 → javac → d8 → zipalign → apksigner 全过，**545577 B**（`Skin`、`values-night/` 已进包） |
>
> 没做的：真机上看白天 / 黑夜两套配色（尤其 `AlertDialog` 与 `EditText` 的默认文字色）、A- / A+ 的实际手感、
> 书架同步标签在「电脑端改过、手机还没同步」时的表现、内联配对面板在窄窗口下的换行、`recreate()` 之后
> 编辑器滚动位置（会回到章节开头）。

> **第三十七轮（R37）**：全插件审计（Host / 客户端 / Android）。按要求不做真机回归，只跑离线脚本、语法、
> 客户端构建与 APK 重打：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`lib/{lansync,secrets,smtp,imap,ai}` 与 `client/src/{10-db,40-ui,50-shelf,60-editor,90-app,95-dialogs,07-locale}`） | 全部 exit 0；Java 由构建里的 `javac` 兜底 |
> | **宿主离线测试** | `node scripts/verify-host.mjs` | **165 → 174 项，失败 0**（原脚本因 `lib/cloud.js` 早已删除而启动即崩） |
> | **合并与串行化** | 同上第 [9] 节新增用例 | 墓碑双向胜负、同毫秒平局归活本、规则 5 洗白、并发 `push` 三本不丢书 |
> | **docx 契约** | `node scripts/verify-docs.mjs` | **44 项全过**（两条过期断言从 12pt/480 改到 14pt/560） |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts → 880561 字节**，`verify-client-load: ok` |
> | 语言表 | 扫本轮新增中文串对 EN 词典 | 新增 5 条（快照失败、校对/排版失效护栏、`当前章`）已补 |
> | **APK 重打** | `node tools/build-apk.mjs` | aapt2 → javac → d8 → zipalign → apksigner 全过，**537385 B** |
>
> 没做的：真机同步与界面回归（Esc 栈、校对护栏、配对轮询、截图级别的版面）、SMTP / IMAP 的真实收发
> （超时与 `EXPUNGE` 的改动只经代码审查）。

> **第三十六轮（R36）**：手机显示密文的问题。按要求「不要做太多测试」，只做了语法、构建、同步缓存层的
> 小脚本冒烟，**没有真机同步**（手机端 Java 未改，APK 不需要重打）：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`lib/lansync.js` / `lib/library.js` / `lib/secrets.js` / `10-db` / `90-app` / `95-dialogs` / `07-locale`） | 全部 exit 0 |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts → 871476 字节**，`verify-client-load: ok (id=@local/novel-writer, inject=["slots"])` |
> | **同步缓存落盘** | 临时脚本（已删）在临时 `DSH_HOME` 里直调 `pushLibrary` | 文件以 `NWENC1` 开头、**不含正文**；`readSyncState()` 读回「第一章」 |
> | **旧明文缓存兼容** | 同上，手写旧格式 `sync-state.json` | 照常读出「旧文件」 |
> | **密文洗白（合并规则 5）** | 同上，镜像放 `enc:v1:AAAA`、同时间戳推明文 | `stats.repaired 1`，结果正文「正文」，落盘仍是密文 |
> | **坏容器退化** | 同上，`NWENC1` 后面塞乱码 | `readSyncState()` 返回 0 本，不抛异常 |
> | 密钥竞争修复 | 同上，全新 `DSH_HOME` 直接派生 | 修 `readStore` 前首次派生必失败（`key.bin.<hex>.tmp` 残留），改为先建密钥再读储后成功 |
>
> 没做的：真机「加密 + 同步」走一遍（推明文与写回加密都只经代码审查与缓存层冒烟）、
> 手机端 SharedPreferences 明文的提示文案在真机上的显示。

> **第三十五轮（R35）**：扫码取景、一键导出全部、首页去掉快捷入口卡三件事。按要求「不要做太多测试」，
> 只做语法、构建、bundle 加载校验、导出接口冒烟与 APK 重打，**没有在真机上对着二维码扫一次**，
> 全量导出的「点设置里的按钮」也只走了 Host 接口那一层：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`lib/routes.js` + `30-io` / `55-welcome` / `90-app` / `95-dialogs` / `07-locale`）；Java 由构建里的 `javac` 兜底 | 全部 exit 0 |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts → 869202 字节**，`verify-client-load: ok (id=@local/novel-writer, inject=["slots"])` |
> | 语言表 | 临时脚本扫 `NW.t('…')` 字面量对 EN 词典（已删） | literal keys **125**，缺失 **0**（一键导出的 4 条新字串已补） |
> | **`export.all` 冒烟** | 临时脚本直调 Host（已删），txt | 3 本（含两本同名）→ zip **388 B**，条目 `重叠.txt / 重叠 (2).txt / 第三本.txt`，`count 3`、`failed []` |
> | 同上，docx | 同上 | 2 本 → zip **7465 B**，条目 `甲书.docx / 乙书.docx`，内层含 `word/document.xml`；`export.build` 单本导出不受影响 |
> | **APK 重打** | `node tools/build-apk.mjs` | aapt2 → javac → d8 → zipalign → apksigner 全过，`dist/精神空间.apk` **533289 B** |
> | APK 结构 | `unzip -l` + `dexdump` | `classes.dex` **514820 B**；dex 里有 `displayOrientation` / `bestPreviewSize` 两个新方法 |
>
> 没做的：真机扫码（预览朝向与四向解码只经代码审查）、设置里「导出全部…」的实际点击与下载落盘、
> 首页删掉卡片后的版面回归。`aapt2 dump badging` 没再跑——权限与 versionCode 本轮未变。

> **第三十四轮（R34）**：手机同步 + 手机 App + 模型自动回退 + 两处 bug 修复，收尾时又把**手机配对改成手填
> 「电脑地址 + 配对码」**（扫码降为备选）。按要求「不要做太多测试」，只做语法、构建、bundle 加载校验、
> APK 打包与静态检查，**没有做真机同步、也没有逐条点界面**：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`lib/routes.js`、`lib/lansync.js`、`lib/lansync-server.js`、`lib/qr.js`、7 个改动的 client part） | 全部 exit 0 |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts → 866020 字节**，`verify-client-load: ok (id=@local/novel-writer, inject=["slots"])` |
> | 语言表 | 临时脚本扫 `NW.t('…')` 字面量对 EN 词典 | literal keys **114**，缺失 **0**（手填配对的 7 条新字串已补） |
> | **APK 打包** | `node tools/build-apk.mjs` | aapt2 compile/link → javac → d8 → zipalign → apksigner 全过，`dist/精神空间.apk` **533289 B** |
> | APK 元数据 | `aapt2 dump badging` | `package='com.novelwriter.app' versionCode='1' versionName='1.0.0'`，minSdk 24 / target 34；权限 INTERNET / ACCESS_NETWORK_STATE / ACCESS_WIFI_STATE / CAMERA / POST_NOTIFICATIONS |
> | APK 结构 | `unzip -l` + `dexdump` | `classes.dex` 513364 B + `META-INF/NOVELWRI.{SF,RSA}` + `resources.arsc`；dex 里有 `PairActivity` / `Pairing` 两个新类 |
> | 模型回退 | 代码路径审查（无自动化） | 三处调用点都走 `withModelFallback`；`aborted` 不重试 |
>
> 墓碑胜负与 `pair.info` 端口这两处修复只经代码审查确认，**没有跑双端同步的回归**；
> 手填配对的新界面同理，**没有在真机上走完「填两行 → 配对成功」**。

> **第三十三轮（R33）**：只改了 client（左上角胶囊去掉中间的「目录开合」、首页同时展开目录、左缘把手恢复），
> 按要求「不要测试」，只做语法、构建与 bundle 加载校验：
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`client/src/60-editor.js`、`client/src/90-app.js`）+ 全仓 31 个模块 | exit 0，0 失败 |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts / 808211 bytes**，`verify-client-load: ok` |
> | 残留 prop 扫描 | `Select-String 'onToggleShelf'` | bundle 与源码均 0 命中（旧 prop 已彻底移除） |
> | 类名 / 语言表 | 静态审计脚本 | 渲染类 296 / 缺样式 0；语言键 141 / 缺 0 |
>
> **第二十七轮（R27）**：按要求「不要测试」，只做构建、语法校验、bundle 加载校验与静态断言；
> 另外为定位「按钮与便签打架」做了几次几何测量（只读，不改数据），并在活 Host 上直接调了一次推荐接口。
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 语法 | `node --check`（`lib/ai.js`、`lib/routes.js`、7 个改动过的 client part） | 全部 exit 0 |
> | 构建 + 加载校验 | `node scripts/build-client.mjs` | **20 parts / 775355 bytes**，`ok (id=@local/novel-writer, inject=["slots"])` |
> | **角落按钮与便签不重叠** | CDP 读 rect（便签关/开两态） | `acts` 恒为 `{x:294,y:10,w:92,h:28}`；开卡片后 `card {x:294,y:92,w:320}`、`page {x:643}`、`surfacePad 348px`；四组 overlap 全 `false` |
> | 窄面板释放车道 | `Emulation.setDeviceMetricsOverride width:700` | `padLeft 0px`、`acts {x:14}`、`card {x:14,y:92,w:320}` |
> | 便签折叠把手可见 | CDP 读 `.nw-notes-tab` | `{label:"收起", opacity:"0.72", x:14, y:52, w:70, h:32}` |
> | **大模型推荐（无节选）** | `POST journals.recommend` | `by:"rules"`、6 条 |
> | **大模型推荐（带节选）** | 同上 + 209 字节选 | `by:"model"`、**6334ms**、6 条带 `fit/verdict/reason/quality`，例如读者·原创版 `62 / 略欠`、百花园 `58 / 略欠`、北极光 `尚不足` |
> | 客户端推荐卡文案 | 投稿向导第 2 步截图 | 标题为「大模型读过开头，按契合度与水准推荐」，每行带 `略欠 / 尚不足` 徽章 |
>
> 没有跑 CDP GUI 套件、没有点完整投稿流程。
>
> ### 第十六轮（R16）的历史验收（保留）
>
> 本轮只做构建、语法校验、bundle 加载校验、bundle 静态断言，
> 以及宿主接口的连通性冒烟；界面上的点击验收由用户在真实 Harness 里自行完成。
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 每个 client part 语法 | `node --check client/src/*.js`（`00-boot`/`99-end` 为 factory 包装，单独 check 必然失败，属预期） | 18 个真实 part 全部 exit 0 |
> | Host 模块语法 | `node --check index.js` + 12 个 `lib/*.js` | 全部 exit 0 |
> | 构建产物 + 加载校验 | `node scripts/build-client.mjs`（内含 `verify-client-load.mjs`） | **20 parts / 720680 字符**，`ok (id=@local/novel-writer, inject=["slots"])` |
> | **R16 静态断言** | `node %TEMP%\nw-cdp\audit-r16.mjs`（扫 bundle） | 19 项全过：无明文开关 / 无「解密出明文副本」/ 首页按钮无文字 / `nw-surface-acts` / 便签无头尾栏 / `HOME_LIMIT = 3` / 收件箱删除键 / 标点开关 / `bookWords` / 无 `nw-shelf-import` / 等级徽章 |
> | 字数口径双端一致 | `POST submit.prepare`（`countPunctuation` true / false） | `他来了。他走了。` → **8 字** / **6 字**，邮件主题里的字数同步变化 |
> | 期刊等级分布 | `POST journals.list` | `{national:6, provincial:33, municipal:19, other:10}`，人民文学 = `national` |
> | 收件箱删除路由 | `POST inbox.delete {uid:0}` | 200 + `bad-request`「缺少要删除的邮件编号（uid）」 |
> | `plain` 字段清理 | `POST library.get` + 读 `settings.json` | 返回体已无 `plain`；磁盘上 `plain:true` 已删除，剩余键 `lastMirrorAt,encrypt,dir,journals,mirror,smtp,imap` |
> | selftest | `POST /novel-writer/api/selftest` | 全项 ok（webServer / docx / epub / secrets / ai / journals / smtp） |
>
> 除此之外**没有**跑 CDP GUI 套件、没有点界面。
>
> ### R13 的历史验收（保留）
>
> | 检查 | 命令 / 方式 | 结果 |
> | --- | --- | --- |
> | 方言覆盖率 | 扫全部 `NW.t(...)` / `tr(...)` 字面量 vs EN 词典 | 95 个 key，缺失 **0** |
> | 样式覆盖率 | 扫全部 `className: 'nw-…'` / `class="nw-…"` vs CSS 文件 | 242 个渲染类，未加样式 **0** |
> | **容器查询落点** | `Select-String -Pattern '@container'` | 9 处：`05-css`（声明容器）、`45-dialogs-css`×2、`55-welcome`、`60-editor`×2、`97-theme`、`98b-responsive`×3 |
> | **视口断点残留** | `Select-String -Pattern '@media'` | 只剩 `prefers-reduced-motion`×6、`hover:none`×1，以及 `97-theme` 里包在 `@supports not (container-type)` 里的那一个 `max-width:900px` 兜底；常规宽度断点 **0** |
> | **构建闸门拦过一次** | `build-client` | 抓到 `97-theme.js` 注释里的反引号（第四次同类事故），修后 20 parts 通过 |
>
> ### 为什么多了一个 `verify-client-load.mjs`
>
> `node --check` 只证明文件能解析，**不证明 factory 能跑**。R9 就踩过：某段 CSS 模板字符串的注释里出现了
> 一个反引号，提前闭合了模板串 —— 语法依然合法，但 bundle 一被求值就抛 `ReferenceError`，整条模块图断掉，
> 面板直接从界面上消失。R12 又踩了同一个坑（`55-welcome.js` 的注释里写了 `` `.nw-welcome-sub` ``），
> 这次是构建闸门当场拦下的。所以 `scripts/build-client.mjs` 写完文件后会**自动跑一次加载校验**，
> 失败则构建以 exit 1 结束。

**已经明确会变的东西**（自测时先知道，免得当成 bug）：

| 变了什么 | 现在在哪 |
| --- | --- |
| 顶部工具栏整条没有 | 侧栏 topbar 六个图标 + 右下浮动坞（只剩 AI 校对 / 一键排版 / 修改建议 / 投稿） |
| 打开插件先看到首页 | 首页四张卡（含收件箱）；点章节 / 继续写作才进编辑器 |
| 设置不再是长滚动 | 左导航 + 右内容，右栏自己滚 |
| 投稿向导是三步 | 选小说 → 选期刊 → 邮件预览（预览页所有字段都能改） |
| **选定期刊就出邮件（R12）** | 点「下一步」直接落在预览页，不再需要手动点「按期刊要求生成」 |
| 主题九套 | 设置·外观，色块两行（含 R10 新增「杂志」） |
| **云备份没有了** | 改成「自动保存与恢复」：选本地文件夹，改动即写加密 `.docx.nwe` |
| **保存默认加密** | 设置·导出与文件里可以关，关掉后写的是明文 `.docx` |
| 图标换了 | 全部内联 SVG，跟随 `color` |
| **插件叫「精神空间」** | 侧栏按钮、锁屏标题、首页标题都换了；包名/entryId 仍是 `novel-writer` |
| **灵感便签是悬浮卡片（R13）** | 写作页右上角 `✦` 点开一张纸片，浮在正文上方，可随手记 |
| **便签自动保存且按章独立（R14）** | 停笔 600ms 自动落盘，输入框随文字自动变高，切章换内容 |
| **光标可调** | 设置·外观：粗细 / 颜色 / 闪烁 |
| **首页按钮在纸上（R12）** | 写作页左上角 `⌂ 首页`；沉浸模式下也还在（那是唯一的出口提示） |
| **修改建议是并排的（R12）** | 坞里 `✦ 修改建议` 在正文右侧开一列，正文列相应收窄 |
| **收件箱能点开（R12）** | 首页收件箱每一行都是按钮，点开是「邮件」弹窗 |
| **点开即已读（R14）** | 取完正文再 `+FLAGS (\Seen)`，首页未读数随之刷新 |
| **短篇不会被强行分章（R14）** | 单章作品导出 / 投稿排版时不出现「一、新章节」；导出面板可手动勾「不分章节」 |

### 历史验收数字（R2 / R3，仍可复跑但选择器部分已失效）

仓库内三套脚本（无需浏览器）：

| 脚本 | 覆盖 | R2 时结果 |
| --- | --- | --- |
| `node scripts/verify-docs.mjs` | zip / docx / epub / pdf / 导入解析（含 python-docx 外部校验） | 44 / 44 |
| `node scripts/verify-host.mjs` | secrets / routes / ai / library（含假 DAV、MKCOL 自愈、密钥单飞） | 261 / 261 |
| `node scripts/verify-e2e.mjs` | 活 Host 端到端：ping、四格式导出、导入、models、真实模型校对、library、selftest（端口自动探测） | 46 / 46 |

> **这三套脚本在 R9 之后已经过期，不要再当成回归基线**：`lib/cloud.js` 已被删除，
> `verify-host.mjs` 里所有 cloud 用例、`verify-e2e.mjs` 的 WebDAV 全链路都会失败——那是功能被移除的结果，
> 不是回归。要恢复可用状态，得先删掉这两个脚本里的 cloud 段落。

> **R3 / R5 / R9 的「不执行测试」一致**：只做语法 / 构建 / 加载 / 接口冒烟，没有跑集成测试。

真实浏览器 GUI 套件（Chrome + CDP，真实构建产物 + 活 Host API）在 R2 时全绿，仅作历史记录：

| 套件 | 覆盖 | R2 结果 |
| --- | --- | --- |
| A/B/C | 渲染布局、新建小说章节、输入落库、刷新恢复 | 23 / 23 |
| D | 导出 docx / pdf / epub / txt（校验 magic 与体积） | 16 / 16 |
| E | txt / md 导入自动分章 | 11 / 11 |
| F/G | AI 校对逐条接受、一键排版预览应用 | 18 / 18 |
| H/I | 锁定生命周期、密文落盘、重启不复锁、错误密码 | 27 / 27 |
| 打字机 | 长文居中误差、手动滚动抑制、恢复跟随（含沉浸态） | 6 / 6 + 8 / 8 |
| 云备份（**功能已删**） | WebDAV 登录 → 上传 → 列表 → 恢复 → 编辑器重新载入 | 19 / 19 |
| J/K/L/M/N | 目录管理/回收站、版本历史、分栏拖拽、快捷键与查找、主题 | 43 / 43 |
| 并发写 / 跨章切换 | 设置项同 tick 双改、连点建章 order、多章并发、切章不串正文 | 12 / 12 + 16 / 16 |
| 视觉与沉浸 / 交互专项 | 主题外壳同色族、沉浸 9 项、对话框关闭、保存目录、改密码验旧密码 | 35 / 35 + 30 / 30 |

**注意**：R3 改了工具栏结构（导入/导出/校对/排版入口全部搬家）、主题 id、侧栏组件与编辑器光标绘制，
R9 又删了云备份面板并把投稿向导重排成三步，上述 GUI 套件的选择器大部分已经失效，不能直接当回归用。

---

## 4. 架构

```
novel-writer/
├─ index.js                 Host 入口：ctx.inject(['webServer']) 延迟注册路由，异常不拖垮宿主
├─ cordis.patch.yml         `- insert: id: novel-writer, name: @local/novel-writer`
├─ lib/                     Host（Node 内置模块，零依赖）
│  ├─ routes.js             /novel-writer/api/* 分派（55 个方法），恒 HTTP 200 {ok,data|error}
│  ├─ secrets.js            key.bin + store.enc（AES-256-GCM，原子写、单飞防并发铸钥）
│  ├─ ai.js                 listModels / proofread / revise / chatOnce（system 折进 user block）
│  ├─ library.js            保存目录：settings.json + docx 镜像 + NWENC1 加密镜像
│  │                        readSnapshot / readSnapshotText（解密后交给客户端）/ pickFolder / decryptTo
│  ├─ journals.js           内置 79 家文学期刊 + 用户覆盖；rank() 按体裁/字数/风格排序推荐
│  ├─ smtp.js               纯 net/tls 发信：AUTH PLAIN/LOGIN、STARTTLS、multipart + base64 附件
│  ├─ imap.js               纯 net/tls 收信：993 TLS / 143 STARTTLS、RFC2971 ID、BODY.PEEK 头部+摘要
│  │                        readMessage（PEEK 取全文 + MIME/base64/QP/charset 解码 + htmlToText）
│  ├─ zip.js                zipSync / unzipSync（自算 CRC32，zlib deflateRaw）
│  ├─ docx.js               buildDocx / parseDocx（含 appendText 独立段落）
│  ├─ epub.js               buildEpub / parseEpub（含 appendText 追加 <p>）
│  ├─ pdf.js                docxToPdf（officeToPdf → libreoffice-kit 回退）
│  ├─ import-parse.js       parseImport（txt/md/docx/epub，GB18030 回退）
│  ├─ lansync.js            手机同步核心：配对 token / Ed25519 身份 / 共享密钥签名 /
│  │                        mergeLibraries（按书合并，墓碑胜负）/ UDP 41287 发现信标 /
│  │                        宿主侧镜像 sync-state.json（NWENC1，本机密钥加密）
│  ├─ lansync-server.js     0.0.0.0 上的最小 HTTP 监听（默认 41288）：ping / pair.handshake /
│  │                        pair.accept / sync，别的一概不接
│  └─ qr.js                 纯 JS QR 编码（无依赖），输出配对二维码 SVG
├─ client/
│  ├─ client.js             构建产物（勿手改，20 parts 拼接 → 916180 字节落盘）
│  └─ src/                  00→99 按文件名字典序拼接
│     ├─ 00-boot / 99-end        __ModuleLoader__ 封装与 apply 导出
│     ├─ 05-css                  设计 token 层（16/14/13px、圆角、控件高度、间距、阴影）
│     ├─ 07-locale               中文 key → 英文词典
│     ├─ 10-db                   IndexedDB 仓储（加密透明化、写串行化、默认设置）
│     ├─ 15-crypto               PBKDF2 + AES-GCM，跨重启锁定、verifyPassword / changePassword
│     ├─ 20-format               字数/排版/diff/分章/改稿应用
│     ├─ 30-io                   fetch 封装：api/io/ai/library/journals/submit/inbox
│     ├─ 40-ui                   按钮/输入/下拉/分段/开关/对话框/toast 原子组件
│     ├─ 42-icons                内联 SVG 图标集（48 个，24×24 统一描边）
│     ├─ 45-dialogs-css          对话框层样式（含八主题色块、折叠区、diff、三步投稿向导）
│     ├─ 50-shelf                小说章节树（可折叠、"⋯" 菜单、导入入口、40×40 页脚）
│     ├─ 55-welcome              默认欢迎页（创作中小说/统计/投稿记录/收件箱）
│     ├─ 60-editor               叠层编辑器 + 打字机 + 粗光标 + 首页按钮 + 沉浸写作面 + 88px 坞留白
│     ├─ 90-app                  App 状态机（view = home | write）+ slot 注册 + 浮动坞 + 修改建议栏
│     ├─ 95-dialogs              设置(两栏 7 分区)/自动保存与恢复/手机配对/校对/排版/投稿/投稿管理/期刊/读信/锁定/版本/回收站
│     ├─ 96-motion               动效 token 与 keyframes（nw-fade-up / toast-in / slide / pop）
│     ├─ 97-theme               精修层（焦点环/模态/空态/滑块/色块/响应式兜底）
│     ├─ 98-shell-theme         按 data-theme 重映射 --dsw-alias-*，让外壳跟随阅读主题
│     └─ 98b-responsive         三档容器查询（≤980 / ≤780 / ≤560），按面板宽度而非窗口宽度排版
├─ locale/{zh,en}.json      侧栏与面板标题（「精神空间」/ Mindspace）
├─ icon.svg                 侧栏图标
├─ setup-github.cmd         双击即可：存 Token → 建仓 → 上传（走 api.github.com，不碰 github.com）
├─ .tools/                  便携版 Git 2.56 与 GitHub CLI 2.103（被 .gitignore 忽略，不进仓库）
├─ docs/CONTRACT.md         全项目接口契约（文件归属、方法表、命名空间）
├─ docs/CONTRACT-R3.md      第三轮改造契约（主题/光标/坞/侧栏/导出/投稿/加密）
├─ docs/CONTRACT-R5.md      第五轮改造契约（期刊库/投稿四步/八主题/欢迎页/图标）
├─ scripts/                 build-client（含加载闸门）+ verify-client-load + 其余 verify
├─ app/                     Android 客户端（手写 Java，无 Gradle）：书架 / 章节编辑 / 配对（手填为主）/ LAN 客户端 / 前台同步
│  ├─ AndroidManifest.xml   minSdk 24（Android 7.0）/ target 34；INTERNET、CAMERA、POST_NOTIFICATIONS
│  ├─ src/com/novelwriter/app/
│  │  ├─ MainActivity       书架（新建 / 重命名 / 删除书 / 手动同步 / 配对状态 / 解除配对）
│  │  ├─ EditActivity       章列表 + 纯文本正文编辑（新建 / 重命名 / 删除章）
│  │  ├─ PairActivity       配对表单：手填「电脑地址 + 配对码」（也认整行 `nw1:…`），默认入口
│  │  ├─ Pairing            唯一的配对实现：`LanClient.accept` + 落盘 + 拉起同步，失败按类型给话
│  │  ├─ ScanActivity       扫码（备选）取 `nw1:host:port:token`，右侧就是「手动输入地址」
│  │  ├─ Discovery          UDP 41287 广播发现；LanClient 是 LAN HTTP 客户端
│  │  ├─ SyncEngine         push / pull + 合并；Library / Store 是本机书库
│  │  ├─ Skin               白天 / 黑夜：改 uiMode 后再 createConfigurationContext
│  │  └─ SyncService / BootReceiver  前台同步服务与开机自启
│  └─ res/                  图标（五档 mipmap）、values/ 与 values-night/ 两套配色
├─ tools/                   构建与发布脚本
│  ├─ build-apk.mjs         aapt2 → javac → d8 → zipalign → apksigner（无 Gradle）
│  ├─ zip-append.mjs        把 classes.dex 追加进 APK（自写 zip 目录重写）
│  ├─ setup-android.ps1     下载 build-tools 34 / platform 34 / 便携 JDK
│  └─ publish-github.mjs    经 api.github.com 上传（git push 在本机不稳定）
└─ dist/                    构建产物：精神空间.apk（0.52 MB）与 .idsig
```

客户端与宿主的唯一通道是 `POST /novel-writer/api/<method>`，恒定 HTTP 200，
body 为 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`，错误绝不静默。

---

## 5. 已知限制

1. **期刊邮箱与投稿要求需要你自己核对**：内置 **79 家**文学期刊，其中 **58 家**已填入从公开征稿汇总页采集的投稿邮箱，但**全部** `verified:false`、界面上标「待核对」。本插件**不联网抓取征稿启事**（避免把过期或错误信息当权威），邮箱可能已变更，请务必以官方最新征稿启事为准；在「选期刊 → 管理」里改一次就存进 `DSH_HOME/novel-writer/settings.json`。
2. **投稿邮件需要自备 SMTP**：没有内置发信服务。Gmail / QQ / 163 等都要先在设置 →「投稿」里填主机、端口、TLS、用户名与**授权码**（不是登录密码）。未配置时预览页会拦下来，不会静默失败。连接诊断会依次试 **465(SSL) → 587(STARTTLS) → 25(明文)**，并在失败时回报每一步的具体错误。
3. **云备份已彻底删除**（R9）：`lib/cloud.js` 整个文件移除，`NW.cloud` 与备份面板的 WebDAV / GitHub Gist / 文件夹三种后端一并撤掉。现在唯一的异地保存方式是「选一个同步盘文件夹（OneDrive / 坚果云同步目录 / iCloud  Drive 本地目录）当保存目录」——插件自己不再联网。
4. **PDF 导出依赖运行时探测**：无 LibreOffice kit 时 `/ping` 的 `capabilities.pdf` 为 `false`，导出对话框会自动隐藏 PDF 选项。
5. 编辑器是纯文本 / Markdown 源文编辑，不是所见即所得；加粗斜体以 Markdown 记号插入。查找为字面量匹配、大小写不敏感、单次最多 5000 处命中，替换不支持正则。
6. `chmod 0600` 在 Windows 上是 advisory 语义，密钥文件保护依赖 `DSH_HOME` 目录权限。
7. **自动保存是「全量覆盖」而不是增量**：每次触发（停止输入 1.2s 或切章）都重写整库快照。几百章的长篇单次写盘约几百 KB，可接受；但保存目录若放在机械盘或网络盘上会有可感知的延迟。
8. 单章正文整串读写，数千万字级别单章会有明显内存开销（长篇建议按章拆分，这也是目录树的默认形态）。
9. **保存目录只增不删**：`library.mirror` 不删除「上次写过、这次书单里没有」的旧文件（避免误删用户手改过的文件）。同名小说靠 `(2)` 后缀去重，顺序可能随书单顺序漂移。**R16 起文件格式只有 `.nwe`**（加密时 `.docx.nwe`，不加密时 `.docx`），不再有加密/明文两套并存；切换加密后残留的旧文件不会被自动清理，需要手动删。
10. **自动保存的密钥就是宿主 secrets 的 `key.bin`**：删掉 `DSH_HOME/novel-writer/secrets/` 之后，之前写出的 `.nwe` 再也解不开（这是加密的正常代价）。要换机，请连 `secrets/` 一起拷。
11. **沉浸模式的全屏依赖浏览器 `requestFullscreen`**：桌面版 WebView 里可能被策略拒绝（此时沉浸本身仍工作，只是不占满显示器）。
12. **九套主题都会重映射 `--dsw-alias-*`**（作用域限定 `.nw-root`）。这是让外壳跟随主题的必要手段，但宿主后续改 token 语义时 `98-shell-theme.js` 需要同步。
13. 编辑器渲染依赖真实浏览器排版（字体度量、滚动容器）。用无头 / 假 DOM 时打字机居中与粗光标位置无法验证。
14. **R3 起的改动均没有跑自动化测试**（用户要求「改完由我自己测试」），所以 `journals` / `smtp` / `imap` / `submit` / `library` / 导出 `appendText` / 九套主题 / 浮动坞 / 粗光标 / 灵感便签 / 落盘 docx / 欢迎页 / 收件箱这些新代码路径，只经过了 `node --check`、`build-client`（含加载闸门）、以及宿主接口的连通性冒烟，**没有逐条功能回归**。
15. **SMTP / IMAP 只实现了明文 / STARTTLS 与 AUTH PLAIN/LOGIN**：OAuth2（Gmail 现代登录、Outlook）不支持，必须改用应用专用密码；服务端 15–20 秒墙钟超时，超时即失败不重试。
16. **投稿记录只存在本机** `DSH_HOME/novel-writer/submissions.json`（最近 50 条），R5 已加入状态流转（`sent / pending / accepted / rejected / published / withdrawn`），但**不与期刊系统对接**——真正送达仍然是一封你确认后发出的邮件，状态需要你自己在「投稿管理」里更新。
17. **收件箱列表只读最近 12 封的头部与 32KB 摘要**；点开一封才会用 `BODY.PEEK[]` 拉全文，附件不下载、不回信、不删除。**R14 起点开即标已读**（取完正文补 `+FLAGS (\Seen)`），所以未读点会随阅读消失；想只看不标可传 `markSeen:false`。被墙或服务器限流时首页会显示服务器原话而不是「没有回信」。Gmail 需要先在网页端开启 IMAP 并生成应用专用密码。
18. **163 / 126 的 `Unsafe Login` 可能仍然存在**：R11 已补 RFC 2971 `ID` 握手（`name=novel-writer`），但网易的白名单是按客户端名审核的，握手之后仍可能被拒。此时错误码是 `imap-id-required`（不再是「密码错」），请按提示把客户端加入白名单，或换 QQ / Gmail 收信。QQ 邮箱的 IMAP 需要在网页端「设置 → 账户」里手动开启。
19. **导出会跳过没有正文的章节**：只写了标题、正文还空着的章节（大纲占位）在 docx / epub / txt 里不会出现，否则会留下「一整页只有一个标题」或者干脆一页空白。这一条在 R11 定下，先前版本会把空章也排进去。
20. **期刊「删除」是写墓碑而不是物理删除**：内置 79 家来自代码里的常量表，若只从用户覆盖层移除，下次 `merge()` 会把它们复活。墓碑存在 `settings.json` 的 `journals` 键里，跟着 `DSH_HOME` 走；换机不拷这个文件，删除会「复原」。
21. **GitHub 上传需要你自己跑一次 `setup-github.cmd` 并粘一次 Token**：本机到 `github.com` 的连接间歇性中断（`api.github.com` 一直正常），所以浏览器 OAuth 设备流和 `git push` 都会随机失败。脚本因此改走 REST API，只访问 `api.github.com`；若某次仍失败，网络恢复后重跑即可（本地提交已保存）。仓库名默认 `novel-writer`，想换就改脚本里的 `REPO=`。
22. **R27 的期刊推荐是「模型意见」而不是「录用概率」**：模型只读稿件**开头 2400 字**（声音、趣味、语言水准在这一段基本能看出来，情节不能），所以它擅长判断「调性合不合」，不擅长判断「后半程会不会崩」。`fit` 分数仅供排序参考，卡面刻意只显示「够格 / 略欠 / 尚不足」三档而不显示数字——一个分数会被当成承诺。模型不可用、超时或返回无法解析时自动退回规则排序，并在卡面注明原因。想换模型去 设置 →「写作」→「校对默认模型」，推荐与校对共用这一项。
23. **修改建议栏给的是意见，不是自动改稿**：它不会替你改写正文，也不会把建议写进文件；点一条只是把正文滚到那一段并高亮。模型每章最多返回 8 条、按 4000 字分块串行处理，所以很长的章会慢（一次审读十几到几十秒），且**同一章不同次审读结果会不一样**——这是生成式模型的常态，不是 bug。定位靠模型回引原文后 `indexOf` 对齐，作者随后手改过的段落会显示「原文已改动，定位不到」。
24. **「首页」按钮是编辑器的一部分**，不跟随滚动；它在 `.nw-page` 之外、`.nw-surface` 之内绝对定位在左上角，因此换主题时会跟着变颜色，但不会与正文重叠（正文左右有 48px 内边距）。
25. **响应式的度量单位是「面板宽度」不是「窗口宽度」**：`.nw-root` 声明了 `container-type:inline-size`，三档断点写的是 `@container nw (max-width: …)`。所以**把宿主侧栏拉开、或把 Harness 窗口调窄，插件会换档；把窗口调宽但宿主右栏占着，插件不会换档**——这是有意的，插件在 shell 里就是一列。用不支持容器查询的旧引擎时，`97-theme.js` 里留了一份 `@media (max-width:900px)` 的兜底，但 780 / 560 两档会失效。
26. **窄面板（≤560px）下侧栏与修改建议栏改成浮层**：它们不再占正文宽度，而是盖在正文上，进去后要再点一次按钮才收起（不像宽面板里是并排常驻）。侧栏浮层的 `z-index` 故意高于浮动坞，否则窄面板里侧栏底部的按钮会被坞压住、点不到。
27. **灵感便签是绝对定位的悬浮卡**，不参与布局，所以它**不会把正文挤开**；代价是面板很矮时（窗口高度 &lt; 约 600px 且侧栏展开）卡片可能压住正文顶部，此时正文仍可滚动、卡片可随时 `Esc` 收起。**R14 起一章一份**（按 `chapterId` 存），自动保存、随文字自动变高（上限 420px），清空即删除 —— 仍然**不支持一屏多张便签**，这是 R10 起就有的取舍（用户要的是「随手记一页」而不是笔记列表）。
28. **保存目录里的文件格式只有 `.nwe` 一种**（R16 起）：加密版是 `.docx.nwe`，不加密时是 `.docx`，两者不会并存。R15 那个「同时写一份明文」的开关已经删除，`settings.json` 里的 `plain` 字段也清掉了 —— 如果旧目录里还留着 R15 时期生成的明文 `.docx`，下一次自动保存会把它当作遗留文件删掉。
29. **期刊等级是从标签推导的，不是独立数据**：`tier` 取「国家级 / 省级 / 市级」标签，没标签的一律算「其他」，所以它只是投稿难度的粗略参考；用户可以逐刊覆盖，覆盖值会写进 `settings.json` 的 `journals` 覆盖表，但一旦覆盖就不再跟随标签变化。
30. **「统计字数包含标点符号」是全局开关**：关掉后状态栏、首页书籍总字数、投稿预览里的字数会同时扣掉标点（`\p{P}` 与 `\p{S}`），但**已经存进 IndexedDB 的 `wordCount` 字段不会重算**——旧章节要等下次保存才更新，书籍总字数因此可能在切换开关后短暂滞后。
31. **收件箱删除是「标记 + 清空」两步**：先 `UID STORE +FLAGS (\Deleted)`，再优先 `UID EXPUNGE <uid>`（RFC 4315）；**只有**在 `CAPABILITY` 里看不到 `UIDPLUS` 时才回落整箱 `EXPUNGE`（R37 之前是「失败了就回落」，一次无关的错误会把全邮箱其它已删除邮件一起清掉）。若两步都失败，返回 `expunged:false`，界面会提示「服务器只把邮件标记为已删除，需要在你自己的邮箱里再清一次」。
32. **手机同步只在同一个局域网内成立**：没有云端、没有中继，手机与电脑必须在同一 Wi-Fi / 同一网段。桌面侧要同时满足
    「DSH 在跑」「插件启用」「写作页没被锁」三个条件，浏览器每 6 秒才去问一次宿主镜像——关掉页面或锁屏期间手机推来的改动
    只停在 Host 镜像里，重新打开并解锁后才会落进 IndexedDB。LAN 端口（默认 41288）是**明文 HTTP、没有 TLS**，
    只适合可信的家庭 / 办公网络，**绝不要把端口映射到公网**；Windows 防火墙第一次询问时请放行「专用网络」，
    UDP 41287 的发现广播被防火墙拦掉也不影响扫码配对。
33. **清空回收站会把墓碑一起清掉**：桌面端的删除墓碑是从 `trash` 里 `kind === 'novel'` 的条目派生的，
    「清空回收站」把整张表 `clear()`，于是这台电脑不再记得「这本书是我删的」。此时一台在删除期间离线、
    仍持有旧书的手机下次同步会把书**原样推回来**。想彻底删掉一本书，最好在两端都删一次，或者删完先同步、
    等手机也删掉之后再清空回收站。
34. **手机端是明文存储**：R36 之后「正文加密」和「手机同步」可以同时用，代价是加密的边界只到手机为止——
    桌面推出去前解密，手机落地就是纯文本（`SharedPreferences` 里没有加密），所以手机丢失或被人解锁，
    书稿就是明文。真在意这点就别配对手机，或者只在桌面端写作。
35. **APK 是 debug 签名的旁加载包**：`dist/精神空间.apk` 用固定的 `debug.keystore`（`storepass`/`keypass` 都是
    `android`）签名，没有上架任何商店、没有自动更新，升级要手动装新包；**换签名必须先卸载旧版**，配对信息也会随之丢失。
    构建依赖 `.tools/android/` 里下载的 SDK 与便携 JDK（`tools/setup-android.ps1` 可补齐），不是一台机器都能直接出包。
36. **手机端只是「能看能改」的第二块屏幕**：只有书架与纯文本章节编辑（新建 / 重命名 / 删除 / 改正文），
    **没有**版本历史、校对、一键排版、导出、投稿、灵感便签、加密与锁定；后台同步受系统电池优化策略影响，
    被系统掐掉时只能回到 App 手动点「同步」。
37. **配对默认靠手抄两行，扫码只是备选**：桌面面板印的是「电脑地址」与 12 位「配对码」，
    手填比扫码慢，而且配对码 **5 分钟**就失效——抄到一半过期只能在电脑上重新生成再抄一次。
    之所以把它当默认路径，是因为手机相机对着这块面板对焦不稳，扫十次里总有一两次读不出来；
    两行字则永远读得出来，还能「复制这两行」再发给手机。地址填错时 App 会提示「连不上 X:Y」，
    配对码填错会提示「配对码不对，或者已经过期」，两种失败都分得清。
38. **全量导出是「一次性 zip」，不是增量备份**：`export.all` 在 Host 内存里把每本书按默认格式渲染完、
    整个打成压缩包再一次性下发，所以书多、图多（封面）时内存与体积都会顶上去，慢的时候浏览器只看到
    「正在导出…」。它不是版本历史、也不是可增量恢复的备份；要备份数据库请用设置里的「导出 JSON / 恢复」。
    失败是「整批里去掉这一本」而不是重试，最后的 toast 只报数量（「已导出 N 部，M 部失败」），
    没有单独的失败清单面板，想知道是哪一本失败得去看 Host 日志或再单独导一次。
39. **扫码取景按设备挑尺寸，仍可能拉伸**：预览档位是从 `getSupportedPreviewSizes()` 里挑「最接近 16:9」的一档，
    遇到只给 4:3 的机型，竖屏下画面还是会被轻微拉伸（二维码仍能解，只是取景框看起来不方）；
    四向解码是「先原位、再转三次」，慢机器上连续失败帧的耗时会上去。
40. **手机端删章节仍然不会同步到电脑**：手机版只给整本书写墓碑（书级 LWW），章节级没有墓碑，
    所以在手机上删掉的章，电脑下一次推送会让它复活（电脑那侧的章还在）。R37 只修了「删书能同步」，
    章级墓碑要改协议与两侧合并逻辑，本轮没做。真要在手机上删章并且让电脑也删，请在电脑端再删一次。
41. **手机端整库 JSON 仍是同步序列化**：R39 把编辑器的保存挪到了 `Store.updateInBackground`
    的单线程队列（解析 → 改 → 序列化都在后台，主线程只收结果），但书架 `render()` 与同步线程仍各自
    整库解析一次；几十万字的库在低端机上仍可能掉帧。扫码回调把相机的复用 buffer 直接丢给解码线程，
    下一帧可能把它覆写（偶尔解不出，重扫即可）。
42. **`Store` 遇到损坏的库 JSON 会回落到空库并照常保存**：`SharedPreferences` 里的 `library` 解析失败时，
    手机按「空书架」启动，随后任何一次编辑都会把空库写回去，原来的书就只剩电脑那一份（同步会重新拉回来，
    前提是电脑还留着）。没有做备份文件轮转。
43. **IMAP 的 8bit / 7bit 正文仍按 UTF-8 解**：base64 与 quoted-printable 会按 `charset` 正确解码，
    但服务器直接给 8bit 的 GB2312 / GBK 老邮件（多见于国内老系统）会显示成乱码 —— 修它要让
    `parseFullBody` 收原始 `Buffer` 而不是已经 `toString('utf8')` 过的字符串，属重构，本轮没做。
44. **离线测试脚本只覆盖宿主**：`scripts/verify-host.mjs` 现在跑 174 项（ping / models / proofread /
    export.build / secrets / library / selftest / lansync 合并），**云备份那一整套用例随 R9 一起删掉了**，
    客户端界面（Esc 栈、校对护栏、配对轮询、内联配对面板）与 Java 侧没有任何自动化覆盖；
    `scripts/verify-e2e.mjs` 需要先在跑的宿主（`NOVEL_WRITER_BASE` 可指定端口）。
45. **手机主题是手动开关，不跟系统深色模式**：☀ / ☾ 只写 `Skin` 自己的偏好，读系统 `uiMode` 只在首次
    没有记录时借用一次；系统在日落时自动切深色时，App 不会跟着变。切换走 `recreate()`，编辑器会回到
    章节开头（正文不丢，`onPause` 里已经 `flush()`），长章里换主题等于重新找到刚才那一行。
46. **书架的「已同步」是本地时间戳推断**：它记的是「这台手机上次同步成功时，这本书的 `updatedAt`」，
    所以电脑端之后又改过这本书、而手机还没再同步时，手机仍会显示「已同步」——它只回答「我这边有没有
    未推出去的改动」，不回答「电脑那边有没有更新的稿子」。真要知道，点一次「同步」。

---

## 6. 许可

Copyright (C) 2025 Jokii-Joy

本项目以 **GNU General Public License v3.0 or later** 发布，全文见仓库根目录的 [LICENSE](../LICENSE)。
可自由使用、修改、分发；分发修改后的版本须同样以 GPL-3.0-or-later 开放源代码并保留版权声明。
本程序不提供任何担保。

47. **手机编辑器的滚动改成了「外层 ScrollView + 不滚动的 EditText」**（R39）：长章拖动不再让 EditText
    自己重排，光标跟随由 `keepCaretVisible()` 手工做（120ms 节流，只在光标离开可视区中间带时才滚）。
    代价是没有了 EditText 自带的「拖到边缘自动滚动」，光标在屏幕外时只能用手指滚。输入法保留
    `NO_SUGGESTIONS`（关掉拼写检查），所以没有候选词联想，这是为长章打字不掉帧的有意取舍。
