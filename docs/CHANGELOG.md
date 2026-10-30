# 精神空间 · 开发日志与详细文档

> 本文件是从 README 拆出来的完整版：逐轮改造记录、验收数字、架构树、已知限制、
> GitHub 自动上传配置，都在这里。面向使用者的简要说明见仓库根目录的 [README.md](../README.md)。

一个 DSH 双半插件（Host + Client）。左侧栏点书本图标进入 **中央面板**（不是右侧抽屉），
左目录 / 右编辑区的沉浸式布局，数据全部留在本机 IndexedDB。

- 包名：`@local/novel-writer` ｜ 版本：1.2.0 ｜ 入口：`index.js`（Host）+ `client/client.js`（浏览器）
- 依赖：**零运行时第三方依赖**（Host 只用 Node 内置模块，Client 只用宿主提供的 `react` 与主题 token）
- 第六十七轮（R67）改造：**五枚按钮排成从下往上的一级级台阶**。用户说「从下到上，按钮的长度呈阶梯式，上下位置可变。」
  ① **宽度和高度都从布局搬进变量**。`.nw-dock-btn` 的 `width:auto` 换成 `width:var(--nw-dock-w, auto)`、
  加上 `height:var(--nw-dock-h, 42px)`，再给五行各发一组 `--nw-dock-w` / `--nw-dock-h`。R66 的
  「每枚按钮只长成自己名字那么宽」没有被推翻：变量只是把「多宽」从内容算出来改成**排出来**，
  `min-width:max-content` 仍然是保险——哪天某个名字长过它那一级，宁可把台阶踩平，也不许把字裁掉。
  ② **内容是两端对齐的**（`justify-content:space-between`）：图标贴着左端、名字贴着右端，多出来的宽度
  全部落在中间。这样按钮可以一级比一级长，而两侧都不出现白边——这是「阶梯」与「留白」能同时成立的原因。
  ③ **高度也一起收放**（46/44/42/40/38），而且是**只给变量、不改那条规则**：`98b-responsive.js` 里窄屏的
  `.nw-dock-btn{height:36px}` 因此仍然能一把压平五行——如果直接把高度写进 `nth-child` 规则，它的特异性会
  盖过那条响应式覆盖，窄屏就压不平了。
  ④ **（R67b，同一轮返工）顺序按名字长短重排，宽度按行自己的内容算**。第一版把「AI 校对」放在最上层，
  而最上层正是最长的一级（10.4em），四个字占不满 —— 用户说「AI 校对按钮左边的空包太多了，可以把这个
  放在读一遍上边」。于是两件事一起改：顺序变成 排 → 建 → 校 → 读 → 投（四字、四字、四字/六字符、三字、两字，
  从长到短），宽度则按「这一行起码要多宽 + 一样多的余量」重新算（8.21/8.21/7.5/7.21/6.21em 量出来，
  各加约 0.5em → 8.7/8.7/8/7.7/6.7）。**台阶的长短从此完全由名字决定**，不再有哪一级白吃一口空白。
  ⑤ **踩到一个模板字符串的坑**：CSS 注释里写了反引号包住的 `min-width:max-content`，而整段 CSS 是
  `90-app.js` 里的模板字符串——反引号当场把它截断，`build-client` 的加载闸门报
  `the bundle threw while being evaluated / missing ) after argument list`。**注释里不要用反引号**。
  ⑥ `client.js` 重建 21 段 **1070633 字节**，`verify-client-load: ok`；`probe-dock`、`verify-dock-hit`
  （15 条断言）全过。视觉依据仍是手绘 mock（`scripts/.tmp/dock_r67.py` → `dock-r67.png`：
  claude 展开悬停第三行 / claude 收起 / night 展开，宽度与高度都按上面的数字量出来再画）。

- 第六十六轮（R66）改造：**五枚按钮各长各的宽**。用户说「按钮为啥要一样长。按钮左右留空白太多。」
  ① 症结是两个字：`stretch`。菜单是竖排 flex，`align-items:stretch` 让每个子项把整条柱子的宽度撑满，
  而柱子的宽度又被 `min-width:152px` 钉住——于是「投稿」两个字也得占满一条 152px 的长条，右边空出一大截白。
  改成 `align-items:flex-end` + `.nw-dock-btn{width:auto}`，柱子退回 `fit-content`：每枚按钮只长成自己名字
  那么宽，**右缘仍然对齐圆钮**，左缘随字参差——参差本身就是「五个独立按钮」的第二个证据。
  ② 内边距一起收：`--nw-dock-pad-l` 12→10、右内边距 16→13、图标与字的间距 `--nw-dock-gap` 12→10，`min-width` 删除。
  五枚里最长的一枚（「修改建议」）也从 152px 收到约 118px，白边基本消掉。
  ③ 审计不用改，重跑仍全过——第 8 节管的是「有皮、有纵向内缩」，与宽度无关；`client.js` 重建 21 段 **1069434 字节**。
  ④ mock 更新为 `scripts/.tmp/dock_r66.py` → `dock-r66.png`（宽度按各自名字量出来再画，不再是等长示意）。

- 第六十五轮（R65）改造：**五个独立按钮，一枚正红圆形钮**。用户说「每一个都是独立的按钮，按钮间有点间隔，右边的>去掉。悬浮坞改成单红色圆形。」
  ① **整张卡片撤掉**。R63/R64 一直在给「一整块板」调材料，用户这一句把方向换了：不是板子好不好看，而是**它们本来就该是五个按钮**。于是 `.nw-dock-menu::before`（卡面）和 `::after`（尖角）整块删除，菜单退回成一个不画任何东西的柱子——展开时看到的就是五个各自独立的按钮，收起时一起消失、只剩圆钮。
  ② **间隔用「每行自己内缩」作出来，不是给容器加 gap**。这个区别是这轮唯一的硬骨头：`gap` 属于容器，指针落进那条缝命中的是一个不画东西的 `div`，正是 R59 那个死区换了副面孔。所以间隔由行自己的 `::before{inset:4px 0}` 画出——两行之间空出 8px 纸色，而**行盒子仍然首尾相接**：指针落在视觉缝里时命中的是相邻按钮的盒子，点下去有反应、鼠标是手型。审计也换成这条断言：`::before` 必须有底色、必须有正的纵向内缩（`inset 4px top, so the buttons are 8px apart while their hit boxes stay edge to edge`）。
  ③ **每个按钮长出自己的皮**。`--nw-dock-card`（纸色 + 4% 墨）做底，`--nw-line-soft` 55% 的发丝边，再压一点 `fg 6%` 的浮影；悬停时皮上铺 12%→5% 的品牌色薄雾、边加深到 22%、浮影抬到 `0 2px 6px -1px brand/18`。原来那根**分隔线**被删掉——线是同一块板上的东西，按钮既然分开了就不需要它；图标格、行高、字号都不动。
  ④ **右边那个 `>` 去掉**。`.nw-dock-go` 连同 `[data-blocked="1"] .nw-dock-go{display:none}`、`prefers-reduced-motion` 里的那条过渡一起删干净，`item()` 也从三个子元素回到两个（图标 + 名字）。R63 加它时说的是「把卡片右侧的空白收住」，卡片没了，空也就不存在了。
  ⑤ **圆钮变回一枚纯色正圆**。用户要「单红色圆形」：`::before` 的圆角改 `50%`，底色直接用 `var(--nw-brand)`，不掺墨、不做径向渐变；`--nw-dock-ink` 与 `--nw-dock-lift` 两个变量连同夜间那条 `--nw-dock-ink` 覆盖一并删除（夜盘本来就有一套为深底调过的品牌色）；`::after` 那圈内收发丝环也去掉，只剩一个圆。影子里保留一点品牌色染色（`0 8px 20px -8px brand/60`）托住它，静止 `.9`、悬停与展开 `1`。
  ⑥ **审计跟着改了三处**：第 7 节从「六个绘制层」改成「所有存在的绘制层都 `pointer-events:none`」+ 新增「菜单自己不许画表面」（`::before`/`::after` 不许带 `background`/`inset`）；新增第 8 节守「按钮真的有皮、真的有间隔」；第 6 节两条注释的措辞同步（缝是画出来的，盒子仍然首尾相接）。写第 8 节时踩了一次自己的坑：`rules()` 只剥选择器里的注释，规则体内的注释会挡在 `background:` 前面，用 `(?:^|;)` 锚定就永远匹配不到——改成词边界 `\b` 才读得到。
  ⑦ `client.js` 重建为 21 段 **1069318 字节**（比 R64 少 3846 字节，删掉的是卡片、尖角、箭嘴和那圈内环），`verify-client-load: ok`；`probe-dock`、`verify-dock-hit`、`verify-dialog-kinds`、`verify-read-spread` 全过，`verify-host` 219 项 0 失败。视觉依据仍是手绘 mock（`scripts/.tmp/dock_r65.py` → `dock-r65.png`：claude 展开悬停第三行 / claude 收起 / night 展开）。

- 第六十四轮（R64）改造：**坞从「贴上去的一块板」退回同一张纸**。用户说「显得突兀，与背景融入的不太好。」
  ① **先数清「突兀」是哪几样东西叠出来的**。R63 的卡片同时给了四个「我被放上去过」的信号：`--nw-surface-2` 的实底（纸色 + 7% 墨，比纸深一档）、78% 的 `--nw-line` 描边、`0 20px 44px -16px` 的大扩散影、以及一道**品牌色**薄光；再加一枚砖红的圆钮。四层信号都在说「这是一件放在纸面上的物体」，所以看起来只能是放上去的。这轮做减法：**一份材料**——几乎就是纸色本身；**一道白反光**而不是暖光；**一条发丝线**让影子去定义边界；**一枚墨色的印**而不是一颗红按钮。
  ② **卡片等于纸加 4% 墨**。`--nw-dock-card: color-mix(in srgb, var(--nw-fg) 4%, var(--nw-bg))`——从 7% 降到 4%，剩下的边界交给影子。顶部那道光换成白（`--nw-dock-sheen`，14% 白，42% 处消失）：白光是纸受光，品牌色薄光是「一个带色的 UI 元件」，同一个位置换一个颜色，读法完全变了。描边退到 `--nw-line-soft` 的 55%，影子收紧成 `0 16px 34px -22px fg/34` + `0 2px 6px -2px fg/10`，R63 那道 `inset 0 1px 0 bg/45` 的纸口高光一并删掉——它和大阴影是同一件事说两遍。
  ③ **两个材料值提到容器上，主题各自给**。`--nw-dock-card` 与 `--nw-dock-sheen` 声明在 `.nw-dock{}` 里，卡片与尖角都只引用它们。原因是被 mock 当场抓出来的：第一版把 26% 的白光写死在渐变里，浅纸上是「纸受光」，到夜盘就成**一层灰雾**——深底上 26% 的白会整片泛灰，夜盘那张卡反而比 R63 更亮更脏。深色主题里「抬起」的方向是**更亮**，所以夜盘给自己两个数字：卡片掺墨提到 7%（比页面亮一档），白光压到 6%（只留一点轮廓光）。
  ④ **行的标记跟着一起退**。分隔线从 `--nw-line` 95%→30% 改成 `--nw-line-soft` 78%→22%（70% 处拐点、右端渐隐不变，仍从文字左缘 50px 起画）；悬停底色 12%→5% 收到 10%→4%、描边 20% 收到 16%、高光换成 `#ffffff/30`；图标格 6%/5% 收到 5%/4%。逐级退，但层级不能塌：悬停仍有渐变、仍有描边、仍有箭头，只是都不再抢纸面。
  ⑤ **圆钮从红按钮改成一枚墨印**。`--nw-dock-ink` 从「品牌 80% + 前景 20%」改成「品牌 55% + 前景 45%」，夜盘从 80% 降到 72%；`--nw-dock-lift` 里那层品牌色发光换成中性的 `fg/18`（原来的 `brand/45` 是第四层「我是一颗按钮」的暗示）。面还是 `radial-gradient(120% 120% at 32% 18%, 84% → 52% → 90%+纸黑)`，描边 `ink 55% + fg 45%`，内圈白线从 22% 降到 16%、静止透明度 `.45`。盒子仍 52×52、`border-radius:0`、形状由 `::before` 画——R56 起的不变式，碰外观不碰命中区。
  ⑥ **证据仍然只有手绘 mock**。`scripts/.tmp/dock_r64.py`（沿用 `dock_mock.py` 的画法）出 `dock-r64.png` 820×1000：R63-claude / R64-claude / R63-night / R64-night 四格同屏、都展开并悬停第三行。它就抓到了③里的夜盘灰雾，也是这一轮唯一的视觉依据——真机沙箱里仍然起不了浏览器。
  ⑦ `client.js` 重建为 21 段 **1073164 字节**，`verify-client-load: ok`；`probe-dock`、`verify-dock-hit`（14 条断言，含「六个绘制层都对指针透明」）、`verify-dialog-kinds`、`verify-read-spread` 全过，`verify-host` 219 项 0 失败。

- 第六十三轮（R63）改造：**坞做成一张纸卡加一枚印泥钮**。用户说「优化精神空间插件编辑页面右下角的悬浮坞，更美观和设计感。」
  ① **先删掉一层，再谈美观**。同一个坞的属性原来在 `90-app.js` 与 `97-theme.js` 各写一遍，后者特异性更高、源码顺序在后，于是**真正生效的永远是主题层那一条**——R56 的数值改过又改回、R59 漏改一处，成因都在这里。这轮把主题层的坞段削成「定位 + 容器归零 + 沉浸淡出」三件事，所有**画**（底、边、影、尖角、行、图标格、圆钮）只在 `90-app.js` 声明一次。以后改观感只有一个地方要改，也只有一个地方会被审。
  ② **卡片是一张纸，不是一块玻璃**。底色用 `--nw-surface-2`（纸色 + 7% 墨）而不是面板白——白底在暖纸主题上读作「贴上去的一张硬纸板」，纸色只深一档才像同一叠纸里抽出来的一张。上面压一道 5%、46% 处消失的品牌色薄光当作受光。圆角 `calc(var(--nw-r-control) + 6px)`（=16px），和按钮族同一个半径家族，不再随手写 12。描边是 `--nw-line` 兑到 78% 的发丝线——第一次写 62%，在 mock 里几乎看不见，整张卡只剩影子在定义边缘。影分三层：`0 20px 44px -16px fg/30` 给远端扩散、`0 3px 10px -3px fg/12` 贴地、`inset 0 1px 0 bg/45` 当纸口高光；一层影子画不出「有厚度」。
  ③ **小尖角指回圆钮**。`::after` 12×12 转 45°（`right:19px;bottom:-6px`，圆角 2px，和卡片同色），`z-index:-1` 落在卡片之后——尖角的盒子和最后一行的悬停底色重叠，不压到后面去的话，展开时最后一行右侧会多出一块切角。`isolation:isolate` 把 `-1` 锁在坞自己的层叠上下文里。
  ④ **行的信息层级靠留白和一根渐隐线，不靠分割框**。行高 42、图标格 26×26（圆角 8）、标签 `--nw-fs-second` / 500。分隔线从**文字左缘**起算（`calc(var(--nw-dock-pad-l) + var(--nw-dock-tile) + var(--nw-dock-gap))`，12+26+12=50px），向右到 16px 处渐隐：三段 `color-mix` 95% → 70% 处 30% → 透明。从图标左边起画会把图标格串成一列「抽屉」，从文字起画才读作「一条条动作」。悬停底色是 12%→5% 的品牌色斜向渐变（不是平涂），描边 20%——R58 那块板的 11% 平底 + 28% 描边在纸色上像输入框，这轮压低保描边、抬一点渐变。
  ⑤ **右端那个箭头只在悬停时出现**。`.nw-dock-go`（`chevright`，12px，`aria-hidden`）静止 `opacity:0` 且 `translateX(-2px)`，悬停/键盘焦点滑到 `.7`。它不承担任何语义——行的名字、图标、`title` 都在，箭头只是把「这一行会打开什么」补上，同时把右半边的空补齐。`[data-blocked="1"]` 的行不显示（点下去是提示，不是跳转）。
  ⑥ **圆钮从「圆」改成一枚圆角方钮，命中区一个字都没动**。盒子仍是 52×52 的矩形、`border-radius:0`、形状由 `::before` 画——R56 之后这条是不变式，改外观不能碰它。圆的直径等于高度时，四个角永远有一片「点了没反应」的外接区；16px 圆角方钮既接上卡片的半径家族，又比正圆更像一枚盖下去的印。填充色单独提成 `--nw-dock-ink`（品牌 80% + 前景 20%），这样黑夜主题能把它换成「品牌 80% + 背景 20%」——直接拿品牌色兑前景色在深底上会泛出一层粉，兑背景色才是那套主题里该有的暗赤陶。面上用 `radial-gradient(115% 115% at 30% 16%, …)` 提一块左上高光、右下压一角暗，读作印泥而不是贴纸；`--nw-dock-lift` 是三层影（近端 8px、远端 34px、纸口一道内高光），静止 `.82`、悬停与展开回 `1`。`::after` 是贴边 5px 的一圈 1px、白 22% 的内描边：静止 `.5`、悬停 `.85`、**展开时反而降到 `.35`**——展开后图标已经转成叉，这圈线再亮就是两道边在互相吵。
  ⑦ **焦点环搬进画层**。盒子的 `outline` 落在 52×52 的透明矩形上，视觉上会框住一个不存在的东西；改成 `:focus-visible::before{box-shadow:…, 0 0 0 2px brand/55}`（圆钮 3px/40%），焦点圈正好贴住画出来的形状。
  ⑧ **展开时逐行入场**。`.nw-dock-menu[data-open="1"] .nw-dock-btn` 挂 `nw-dock-row-in .2s`（4px 上移 + 淡入），再用 `:nth-child(2..5)` 各加 30ms 延迟，五行依次落定：卡片先出来，字随后跟上。延迟写在选择器上而不是给每行塞一个自定义属性——行是 `item()` 循环渲染的，为一段入场动画多传一个 index 不值。位移只作用在行的 `::before` 与文字上，行的**盒子不动**，所以不会重现 R54c 那种「命中区跟着动画跑」；`prefers-reduced-motion` 里整条关掉。
  ⑨ **审计跟着长**。`verify-dock-hit.mjs` 新增三组：①菜单里**恰好五行**且没有多余元素（切片从 `className: 'nw-dock-menu'` 到 `className: 'nw-dock-fab'`，按 `\bitem\(` 切段数 `h(`——直接数会多出一个，因为切片末尾撞进圆钮自己的 `h('button',…)`，这个 bug 是写完当场撞出来的）；②行不许带 margin（行距属于 R59 那条「容器不许拥有自己的像素」的下一层）；③六个绘制层（菜单 `::before`/`::after`、行 `::before`/分隔 `::after`、圆钮 `::before`/`::after`）必须全部 `pointer-events:none` 且不许被后面改回来。
  ⑩ **这轮没有真机截图**。沙箱里 Chrome 起不来（`platform_channel.cc` 的 mojo 命名管道被拒，crashpad `OpenProcess` 同样 0x5），CDP、悬停、截图全部不可用。替代物是 `scripts/.tmp/dock_final.py`：按上面这些 CSS 数字用 Pillow 1:1 重画三种状态（claude 展开悬停第三行 / claude 收起 82% / night 展开），逐版对照改数。它改对了两处——夜盘品牌色从 88% 降到 80%（88% 在深底上偏粉），卡片描边从 62% 提到 78%（原来只剩影子在定义边缘）。**但它是手画的，不是引擎**：真机上的字体度量、`color-mix` 的插值空间、阴影扩散都可能与它差一点，所以这轮的观感最终以用户在插件里看到的那一眼为准。
  `client.js` 重建为 21 段 **1072158 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit`（14 条断言）、`probe-dock`、`verify-dialog-kinds`、`verify-read-spread` 全过。

- 第六十三轮补丁（R63b）：**「没自动提交」的真正原因是从来没有 `git commit`，而推送日志本身也没说人话**。用户说「没自动提交GitHub，可以用原来的设计，记得改好提交哦。」
  ① **先看清「自动上传」挂在哪**。`.githooks/post-commit` 只在**提交之后**触发 `tools/auto-push.mjs`。R52 之后这十一轮的改动（R53–R63）一直停留在工作区，一次都没有 `git commit` 过——**没有提交，就没有 hook，也就没有上传**。所以 `git status` 里那 17 个文件（`git diff` 记 +4393 / −1211）这次一次性提交、推上 GitHub：`787b68a R53-R63`。这条比任何脚本改动都重要，记在这里免得下一轮又把「忘了提交」当成「脚本坏了」。
  ② **顺手把 hook 链上的两个哑巴修了**。`tools/auto-push.mjs` 原来只认 PATH 里的 `git`：提交本身用的 git 可能在，但 hook 那一层 shell 的 PATH 不一定有（项目自带的是 `.tools/git/cmd/git.exe`，没有人把它加进 PATH）。找不到 git 时 `git remote` 返回空 → 脚本以为仓库没配 origin → 走到 `git remote add` → 又启动失败 → 日志里只留下 `fail: git remote add: undefined`。现在先认 `NW_GIT`、再认随包的 `.tools/git/cmd/git.exe`、最后才回 PATH；并且 `spawnSync` 的 `error.message` 会写进日志——这台机器上它当场就打出了 `cannot run git (…\.tools\git\cmd\git.exe): … EPERM`，比 `undefined` 有用得多。
  ③ **这台机器上的推送是怎么通的**（沙箱限制，不是仓库问题）：`node` 起子进程被沙箱拒绝（`EPERM`），所以 hook 链在这里天然跑不通；直接在 pwsh 里调 portable git 又撞上两件事——schannel 拿不到凭据（`SEC_E_NO_CREDENTIALS 0x8009030e`），换 openssl 后端后 CA 路径因为工作区目录名含中文读不出来（`error adding trust anchors`）。最后把 `ca-bundle.crt` 复制到 ASCII 临时目录、用 `-c http.sslBackend=openssl -c http.sslCAInfo=<temp>` 才推上去，`ls-remote` 确认远端 `main` 已经是 `787b68a`。日常桌面环境里，hook + 默认后端仍然是原来那条路。
  ④ **「原来的设计」这句当场问清了**。这版做完之后用户回的是「可以用原来的设计」——这句话既可能是「保留现在这版」，也可能是「退回旧版看看」，而且旧版（R62）的 CSS 只存在于那一次的工作区里，git 里只有 R52 的原文，真要退回去得照着日志重建。所以没有猜，直接问了一句；答案是**就用现在这版（R63）**：纸卡片、发丝线、印泥方钮都留下，不回退。

- 第五十四轮（R54）改造：**「只照亮正在写的几行」不再是沉浸模式专属**。用户说「不是沉浸模式，编辑页面也改成那种只凸显光标所在的上下几行，其他行变浅」。
  ① **把它和沉浸模式拆开**。R46 的 `focusOn = immersive && settings.focusDim !== false` 里那个 `immersive &&` 是当时的判断：觉得书架和工具栏都在屏幕上时，淡化会「和外壳打架」。但淡化的对象是**纸面**，不是外壳——书架开着，纸上那一段照样该凸显。现在 `focusOn = settings.focusDim !== false`，开关本身（设置 → 写作，「只照亮正在写的几行」）就是唯一的出路，默认仍然开着。`focusLines`（上下各留几行，0–8，默认 2）不变。
  ② **纱只盖纸，不盖书桌**。沉浸模式下纸面几乎等于整个面板，全宽的纱没人察觉；书架开着时 `.nw-surface` 比纸宽得多，全宽的纱会把纸四周的桌面也一起压暗，页面看起来像「灰纸板里挖了个洞」。所以新增一条 `[data-immersive="0"]` 的规则，把 `.nw-veil` 的左右边界收到纸栏（`left/right: calc(50% - min(var(--nw-width,760px),100%) / 2)`，与 `.nw-page` 同一个宽度变量），沉浸模式保留原来的全宽版本——那一版是用户已经认可的观感。上下仍由 `paintFocus()` 按视口像素写，浮动工具栏、页边签都不受影响。
  ③ **淡化强度原样保留**（`--nw-veil-ink` 仍是 72% 纸色）。用户要的是「那种效果」，不是另一种，所以不跟着改浓度。
  ④ **改版时要立刻重画**。原来的 effect 只依赖 `focusOn` / `focusLines`；纱的左右边界现在由 `--nw-width`（页面宽度）决定，所以把 `pageWidth` / `effPageWidth` 也放进依赖——拖宽页面、进出沉浸时纱不会停在上一次的位置。
  ⑤ **设置项文案跟着改**。「沉浸时只照亮正在写的几行」→「只照亮正在写的几行」，提示补一句「沉浸与非沉浸都生效」。
  ⑥ **（R54b，同一轮返工）亮带改成锚在屏幕中间，而不是跟着光标**。第一版把带子放在光标行上，逻辑上没错但用起来不对：打开一章时光标停在第一行，光就落在页面最顶上，整屏字都是暗的，一直要等点一下才「活」过来——用户原话是「我鼠标只要不点，就只凸显最上面的几行」。现在 `paintFocus()` 不再看 `focusTopRef`，直接算屏幕中线：`centerY = round((vzH/2 - bandLines*lh/2)/lh)*lh`（对齐到整行，边界落在行与行之间），`bandLines = focusLines*2+1`。带子不动，反过来让**光标进带**：新增 `bandContentTop()`（把视口里的带子换算成内容坐标）与 `planBandScroll()`（光标在带外就把视口挪到「光标行居中于带」，在带内则一个像素都不滚）。它接在 `planCaretScroll()` 的后面：打字机模式开着时居中本来就把光标放在带心，轮不到它；打字机模式关掉时（用户明确说过「别动我的视口」）只做「别让我在暗处打字」这一件事，靠 `cfg.focusFollows` 开关。顺带的好处是带子不再每次按键重画，打字路径少了一次 style 写入；打开章节时也不再需要先测一次光标才肯显形（原来的 `parked` 条件里有 `focusTopRef < 0`）。
  ⑦ **（R54c）右下角浮动坞的按钮「点不到边」**。用户说「右下角那几个按钮，比如读一遍按钮，鼠标监听没有覆盖按钮整个框」。根因是 hover 位移：`.nw-dock-btn:hover{transform:translateY(-1px)}`、`.nw-dock-fab:hover{translateY(-2px)}`、`:active{scale(.97)}`。**transform 会带着命中区域一起走**——鼠标停在按钮下边缘时，hover 把按钮抬起来 1~2px，指针就落到按钮外面，hover 消失、按钮落回原位、指针又落回按钮上，如此循环。视觉上是轻微抖动，操作上是「下边缘那一圈点不动」。浮动坞正位于屏幕右下角，人是自上而下够它的，最容易压在底边上，所以这个抖动在它身上最明显。修法是把位移全部换成**不动盒子的反馈**：hover 只换底色/描边/阴影（`background`、`border-color`、`box-shadow`），`:active` 改用 `filter:brightness(.94/.96)`。命中区域与视觉边界因此一像素不差。`90-app.js` 的基础规则与 `97-theme.js` 的主题规则两处都改了（后者特异性更高，不改的话前者等于没改）。`prefers-reduced-motion` 里那句 `transform:none !important` 现在没有对象了，留着无害。
  ⑧ **（R54d）「读一遍」压边点不动，还是同一个症状的另一个病因**。R54c 拿掉了 hover 位移，但用户说按钮**还是**框内有死区。这次的根因是 **`border-radius` 参与命中测试**：`.nw-dock-fab` 是 46×46 的圆形（`border-radius:var(--nw-r-pill)`），它的**外接矩形里有约五分之一（四个角）点不动**；`.nw-dock-btn` 是胶囊形，两端各有半圆死角。指针悬在角上时既不显示 hover 也不触发 click，正是「鼠标监听没覆盖整个按钮框」。修法是不动外观、只加一层**不圆角的透明命中层**：`.nw-dock-fab::before,.nw-dock-btn::before{content:'';position:absolute;inset:-1px;border-radius:0;background:transparent;pointer-events:auto;}`（宿主元素补 `position:relative`）。伪元素按宿主元素命中，所以点它等于点按钮；`inset:-1px` 连 1px 边框那一圈也一起覆盖。两处都要改（`90-app.js` 与特异性更高的 `97-theme.js`）。
  ⑨ **（R54e）首页不该有浮动坞，首页两张卡之间不该有大片空白**。用户说两件事：①「首页不要出现右下角那个按钮」；②「首页的创作统计与投稿记录之间有一大段空白」。
  ① **坞原本无条件挂在 `.nw-main` 里**，而首页也渲染在 `.nw-main` 中，于是「AI 校对 / 一键排版 / 修改建议 / 读一遍 / 投稿」浮在了首页右下角——这些动作在首页一个也用不了（`chapter` 为空时全部 disabled），只剩一枚关不掉的圆按钮压在快捷入口上。现在 `dock` 改成条件渲染：`view === 'write' || immersive ? dock : null`。
  ② **空白是「两张等高」的错觉**。原布局是两个 `.nw-welcome-grid`，每行两张卡：第一行 正在创作 + 创作统计，第二行 收件箱 + 投稿记录。卡片是 `align-items:start`（各自按内容落座，R21 故意如此，避免单行卡被拉成半空面板）。于是**矮的创作统计右边空出一块**，第二行的投稿记录只能从那一块下面开始——读者看到的就是统计卡与投稿记录之间的一大段空白。修法是把「行」改成「列」：`.nw-welcome-cols` 两列，`.nw-welcome-col` 是 `flex-direction:column` 的栈。同一列里的卡**依次紧跟**，没有「和旁边那张对齐」这回事，也就没有洞。分组同时更顺：左列「我的书 + 来信」，右列「数字 + 投出去的稿」。窄屏走 `@container nw (max-width:620px)` 折成一列（注意是容器查询，不是窗口查询——插件是宿主里的一列，按窗口宽会判错）。
  ③ **命中审计成了常设脚本**。沙箱不允许从这里启动 Chrome（`spawn EPERM`，crashpad 与 mojo 都被拒），所以没能做真实浏览器点测。改为 `scripts/verify-dock-hit.mjs`：把全部 `NW.CSS_PARTS` 抽出来做级联分析，断言两件会再次引发「框内死区」的事——(a) 坞的 hover/active 不许有 `transform`（会让命中区跟着元素走），(b) 两个按钮必须带**不圆角的透明命中层** `::before`，且宿主 `position:relative`。这是静态断言，不是浏览器点测，但它能保证同类回归被拦下。`::before` 另加了 `z-index:1`，确保它在按钮内容之上命中。
  ⑩ **（R54f）十字光标的上半截是箭头——命中的是按钮「外面」那一圈**。用户说「'读一遍'按钮鼠标放上去上半部分显示箭头，不显示小手」。R54d 加的透明命中层用了 `inset:-1px`（本意是「连 1px 边框也覆盖」），但那一 1px 落在按钮**盒子外面**：光标落在那儿时，应答它的是按钮背后的页面，于是显示页面光标（箭头），而不是按钮的 `cursor:pointer`。上半部分最明显，因为那一侧没有别的元素挡着。修法：`inset:-1px` → `inset:0`（严格贴合 border box，不越界），并给伪元素自己声明 `cursor:inherit`，永不再靠继承赌运气。另外把 `.nw-dock-btn` 的 cursor 铺到子元素：`.nw-dock-btn:not([disabled]) *{cursor:pointer}`、`.nw-dock-btn[disabled] *{cursor:default}`——icon 包裹层和文字 span 若各自解析成 `auto`，会在可点的行中间画出一支箭头。
  `scripts/verify-dock-hit.mjs` 同时补了两条断言：命中层**不许越出盒子**（`inset` 不许是负数）、命中层**必须自己声明 cursor**。并且做了变异测试确认它不是空转——把 `inset:0` 改回 `-1px` 时脚本当场报 2 处失败，改回来又通过。
  `client.js` 重建为 21 段 **1063219 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
  ⑪ **（R54g）第三次修「上半部分是箭头」——问题根本不在 inset**。R54f 把 `inset:-1px` 收回 `inset:0` 之后，用户重启仍然报同样的症状。这说明前两次都改错了地方。真正的原因：**`cursor` 是盒子的属性，而 `::before` 伪元素没有自己的盒子**。伪元素虽然能参与命中测试（点它等于点宿主），但引擎对它的 cursor 解析并不一致；这几行按钮的上半部分是纯 `padding`、painted 面积比 inline 文字内容大，光标落在那片空白上时就回落成了页面的箭头。修法是把伪元素换成**真元素** `.nw-dock-hit`：`position:absolute;inset:0;z-index:1;border-radius:0;background:transparent;pointer-events:auto;cursor:inherit;`，并让按钮真的渲染出它（`90-app.js` 的 `item()` 里在 `nw-dock-icon` 之前插 `h('span',{className:'nw-dock-hit','aria-hidden':'true'})`，FAB 同样）。真元素有自己的盒子，cursor 就有确定归属；点它仍等于点按钮（它是按钮的子元素）。
  `verify-dock-hit.mjs` 的断言目标随之从 `::before` 改为 `.nw-dock-hit`，保留「不许负 inset / 必须自己声明 cursor / 不许保留 radius / 宿主 position:relative」四条，并新增第五条——**必须有组件真的渲染出 `.nw-dock-hit`**：纯 CSS 规则不会产生盒子，只写样式不插元素的话，这条修复等于没落地，而且前两条断言照样通过。这条规则来自这轮的教训：前两次修复都「静态检查全过、用户依然看得见」。
  `client.js` 重建为 21 段 **1063583 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit` 全过。
  ⑫ **（R55）阅读页宽屏时对开两页**。用户要求「阅读页面如果是全屏模式下，请分两页」。
  ① **判据是宽度，不是某个「沉浸」标志**。读一遍本身就是全屏浮层（`.nw-read` 绝对定位铺满），没有单独的 immersive 开关可读；真正决定能不能并排放下两栏的是**可用宽度**。`measure()` 里 `avail >= 900 && (avail - gap) / 2 >= 300` 才开对开——一栏最多 34 个汉字，两栏加中间空档放得下才并排，否则退回单页。窄面板、手机、被侧栏挤出的半屏都自动是单页，不需要第二套逻辑。
  ② **把「栏宽」和「页宽」拆成两个变量**。原来 `.nw-read-flow` 用 `--nw-read-w` 一个变量同时管 `width` 和 `column-width`，一栏一页时二者相等，所以看不出问题；一旦一页要装两栏，`width` 必须是两栏加空档、`column-width` 仍是一栏。现在拆成 `--nw-read-box`（页宽）与 `--nw-read-col`（栏宽）。
  ③ **三个数字必须同时改对**。这是这块最容易出错的地方，而且错了不报错：`total`（页数）、`scrollToPage/slideToPage` 的步长 `s`、滚动监听换算页码的 `s`。三处原来都各自写 `layout.w + layout.gap`，只改一处的话单页模式看着完全正常，一对开就**翻半页**、页码和 `maxPage` 一起错。现在统一读 `layout.step`（单页 = 栏宽 + 栏距，对开 = 两栏 + 中间空档）。
  ④ **顺手修了一个隐蔽的命名冲突**。`slideToPage()` 里的 rAF 回调原名也叫 `step`，与外层「一页有多宽」的 `step` 同名；`const s = step` 写在回调声明之前，会被推进 **TDZ**，运行时 `ReferenceError`。回调改名为 `frame()`。
  ⑤ **页边签的「在不在这页上」也要按页宽判**。`paintGutter()` 原来用一栏宽 `w` 过滤片段，对开时右半页的批注会全部不出签；改用 `pageW = w * cols + gap * (cols - 1)`。
  ⑥ **中间那道装订线**：`.nw-read-flow[data-spread="1"]{column-rule:1px solid var(--nw-rule)}`。`column-rule` 只出现在同一页内的栏与栏之间，所以正好画在书页正中，不会在页边多出线来；单页模式没有 `data-spread`，样式与之前一字不差。
  ⑦ **几何审计成了常设脚本** `scripts/verify-read-spread.mjs`：把 `measure()` 的规则抄成模型，对 420 / 700 / 880 / 905 / 1100 / 1600 / 2400px 各算一遍，断言 ①切换点两侧行为对得上 ②页宽 == 翻页步长 ③对开时每栏 ≥300px 且 ≥11 个字 ④页数按页宽算时正好是栏数的一半 ⑤源码里自己拼 `layout.w + layout.gap` 的地方只剩兜底那一处、读 `step` 的地方 ≥3 处。写的时候它真的抓到了一条我自己写错的断言（`byPage*2-1 < byCol` 在页数正好是一半时误报），改成 `Math.abs(byPage*2 - byCol) > 1` 才是「成 2:1」的正确条件。
  `client.js` 重建为 21 段 **1065593 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-read-spread` 全过。
  ⑬ **（R56）「上半部分是箭头」第四次——前三次都在治症状，这次换掉前提**。R54d 叠透明 `::before`、R54f 把 `inset:-1px` 收回 `0`、R54g 换成真元素 `.nw-dock-hit`，三次静态检查全过、用户每次都重启后复测仍报同样症状。共同前提一直没动：**按钮自己的盒子还是圆角**，所以命中测试始终跟着圆角走，叠上去的每一层又都是一个带圆角/裁切、需要单独回答 cursor 问题的盒子——加得越多，可疑的盒子越多。
  修法是把前提反过来：**按钮盒子做成纯矩形**（`border-radius:0;border:0;background:transparent;box-shadow:none;`），胶囊改由一个 `::before` 画，且这个伪元素 `pointer-events:none` 并 `z-index:-1` 落在内容之后——它只负责画，永不应答指针，也就不可能贡献 cursor。子元素（icon 包裹层、文字 span）同样 `pointer-events:none`，所以指针只可能落在按钮自己的**矩形边框盒**上，而 cursor 在那里只声明一次。`isolation:isolate` 让 `z-index:-1` 的伪元素留在按钮层叠上下文内而不是跑到祖先背景后面；hover/active 的换色、阴影、`filter:brightness()` 全部挂到伪元素上。分类上，这一改让「有没有圆角命中死角」「伪元素 cursor 归属」「子元素继承 `auto`」「越出盒子那一圈」四种疑点同时不成立。
  审计脚本跟着改了断言结构：不再找命中层元素，而是断言 ①**胜出的** `border-radius` 必须是 `0` ②盒子不带边框 ③`::before` 存在、`inset:0`、有圆角、`pointer-events:none`、`z-index:-1` ④子元素 `pointer-events:none` ⑤`position:relative` ⑥源码里不许再残留 `.nw-dock-hit`。其中第①条最初写成 `.some()`，被变异测试当场识破：`90-app.js` 与 `97-theme.js` 都声明这条属性、特异性相同，只要有一个文件还留着 `0` 就照样通过——而实际生效的是**源码顺序最后一个**。改成逐条按属性累加取最后一个值后，把主题层改回胶囊立即报错，改回来又通过。
  ⑭ **（R56）对开时批注签分左右**。用户要求「阅读页双页时，批注左页的在左侧，右页在右侧，变回单页时再回到右侧」。对开是摊开的书，视线落在哪一页、那页的话就该在该页的**外缘**：两页的签全挤在书缝右边的话，左页的签会跑到右页正文旁边，指认关系是错的。`paintGutter()` 里改为按片段中心点算它落在哪一栏（`colAt = floor((cx - flowRect.left) / (w + gap))`，夹在 `0..cols-1`），左栏的签去 `leftOuter`、右栏的签去 `rightOuter`，并带 `data-side="left"` 便于样式区分；**单页时 `cols === 1`，`onLeft` 恒假，所有签仍在右侧**，与 R53 行为完全一致。左右两边各自排一条泳道（`used` / `usedL`），否则右边的签会因为左边的位置而无谓下移。`leftOuter` 夹了 `Math.max(0, …)`：stage 左右内边距最窄 20px，而签要占 16+3=19px，gutter 是 `overflow:hidden`，不够时会被整枚裁掉。
  `client.js` 重建为 21 段 **1066376 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit` 与 `verify-read-spread` 全过。
  ⑮ **（R57）收起坞拆掉，五个动作摊成一条常驻竖排**。用户说：「我倾向于把他们展开放在右下角的侧边，按钮不用要打，鼠标没有放在上面的时候，就淡化，与背景融为一体，鼠标放上去，再凸显出来，并且显示完整名字，其他时候只显示『读、校、建、排、投』。」
  ① **为什么不再修那个箭头，而是改结构**。R54c→R54f→R54g→R56 四轮都在同一个前提上打补丁：一个**圆角/胶囊控件**要覆盖它的整个外接矩形。用户的复测始终是「上半部分是箭头」。R56 已经把盒子矩形化、把胶囊挪到 inert 的 `::before` 上，理论上无可再改——但**一个命中区需要反复论证的控件，本身就是不适合这个任务的形状**。改成五个普通矩形按钮之后，「有没有圆角死角」「伪元素 cursor 归属」「子元素继承 auto」「越出盒子那一圈」这四个疑点从构造上都不存在了：一个盒子、一次 `cursor:pointer`。
  ② **静止态 = 一个字**。`.nw-dock` 常驻 `opacity:.34`（沉浸 `.22`），hover/focus-within 回到 `1`；每一行在静止时只渲染 `<span class="nw-dock-abbr">读</span>`，hover/focus 时缩写 `display:none`、换成 `<span class="nw-dock-icon">` + `<span class="nw-dock-name">读一遍</span>`。文字和图标的显隐用 CSS 而不是 React state：hover 是纯视觉反馈，走 state 会每帧重渲染整个写作面板。
  ③ **向右对齐 + 向左生长**。坞是 `align-items:flex-end`，展开时行宽变大、左边缘外扩，**指针所在的那条右边缘不动**。这是 R54c 那条教训的延伸：会让命中区从指针下面跑掉的位移一律不要，包括「行变宽」这种隐性位移。
  ④ **`data-on` 保留给「修改建议」**——它开的是论文旁边的常驻栏，栏开着时那一行即使没被 hover 也要显示全名，否则读者看不出是哪个动作把右栏调出来的。
  ⑤ **触摸屏单独处理**：`@media (hover: none)` 下没有 hover，全名永远不会出现，所以在该分支里直接强制「缩写隐藏、图标与全名常显」，并把坞提到 `.85`。
  ⑥ **审计脚本跟着换断言**：`verify-dock-hit.mjs` 现在只审 `.nw-dock-btn`（FAB 已删，审它是审一条不存在的规则），保留「胜出的 `border-radius` 必须是 0 / 盒子无边框 / `::before` 是 `inset:0` 的 inert 画层且 `z-index:-1` / 子元素 inert / 宿主 `position:relative`」，新增三条：源码里不许再渲染 `.nw-dock-fab`；hover 时缩写必须 `display:none`（否则会渲染成「读 读一遍」）；静止时全名必须 `display:none`（否则坞就不「安静」）。变异测试确认能抓到——删掉缩写隐藏那条规则后脚本当场报错。
   `client.js` 重建为 21 段 **1063666 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit` 与 `verify-read-spread` 全过。
  ⑯ **（R58）「校对没反应」是禁用，不是坏掉；坞从五个散字变成一块玻璃板**。用户说：「校对那个没反应。而且你设计美观一些，不要省 token。」
  ① **根因不在对话框，而在 `disabled`**。先把整条分发链查了一遍：`90-app.js` 的 `DialogHost = NW.dialogs[cap(dialog.kind)]`、`cap()` 的首字母大写、`openDialog()` 的 `setDialog`、`95-dialogs.js` 里注册的 `NW.dialogs.Proofread`——全部对得上，`verify-dialog-kinds.mjs` 的 12 种 kind 也一一对应。问题出在 `Dock` 的 `item()`：`disabled: needsChapter ? !p.chapter : false`。没打开章节时五行**全部被禁用**，而 `disabled` 按钮不触发任何事件，点下去就是一声不响——用户当然判定「没反应」。更糟的是视觉上区分不出来：禁用态只靠 `::before` 的 `opacity:.45`，而 `::before` 静止时本来就是 `transparent`，45% 的透明还是透明。
  ② **修法：不要禁用，要解释**。`item()` 去掉 `disabled`，改成 `data-blocked` + `aria-disabled`；点下去仍然走 `onClick`，在开头 `if (blocked) { p.onBlocked(name); return; }`，接线处弹一条 `先打开一章，再 AI 校对` 的提示。`title` 也改成带说明的版本。禁用是一种**沉默的拒绝**，而这里的正确行为是告诉用户「还差一步」。
  ③ **新增 `verify-dialog-kinds.mjs`**：扫四个文件里所有 `openDialog('x')` / `setDialog({kind:'x'})`，对照 `95-dialogs.js` 的 `NW.dialogs.X` 注册表，断言一一对应（注册了但没人调的只记 note，调了但没注册的报错）。另加一条：`Dock` 不许再用 `disabled:`——「一个不响应的控件和一个坏掉的控件，用户分不出来」。
  ④ **坞改成一块玻璃板**。R57 的结构是对的、材料是错的：五个单字漂在纸面上像污点，34% 透明度下没人看得出那里有东西可以悬停。现在整条坞是**一个对象**——`padding:5px`、发丝描边（`color-mix` 把 `--nw-line-soft` 兑到 60% 透明）、`backdrop-filter:blur(8px) saturate(1.05)` 让纸纹透上来、一层 `--nw-shadow-1`；静止 `opacity:.5`，悬停时玻璃**凝固**（底从 42% 提到 86%、描边变实、投影加深），而不是整块跳出来。行改成等宽格子（`align-items:stretch`），鼠标移到哪格，哪格才亮起 `color-mix(brand 11%, panel)` 的底和 28% 描边——**组的身份由板子给，格子的身份由悬停给**。
  ⑤ **缩写的对齐**：`读/校/建/排/投` 都是单字，但字宽不等（读和排的结构不同），所以 `.nw-dock-abbr` 加了 `min-width` 与 `tabular-nums`，五枚才左右成一条线；悬停时缩写和图标一起转 `--nw-brand`。
  ⑥ **审计脚本的一个真实盲点被这轮撞出来并修掉**：`rules()` 的正则从上一个 `}` 开始吞选择器，会把规则上方那段 CSS 注释一起并进 `sel`。于是所有 `s === '.nw-dock'` 这类**精确匹配**的断言实际上一直没命中最主要的那条规则，只匹配到响应式文件里的几行单行规则——`align-items:stretch` 就是这样从审计底下溜过去的。修法是解析前先剥掉注释再压空白。修好之后那条旧断言立刻报错，而它报得**有道理但没有更新**：R57 禁止 `stretch` 是因为「行会被拉得比胶囊宽」，R58 里行本来就该是格子，所以断言改成**条件式**——允许 `stretch`，但不许在没有水平内边距的板子上 `stretch`（否则格子会顶到发丝描边和圆角里，首尾两格被裁）。变异测试：把主题层的 `padding:5px` 改成 `0`，断言立即报错；改回来通过。
  `client.js` 重建为 21 段 **1068015 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit`、`verify-dialog-kinds`、`verify-read-spread` 全过。

- 第五十九轮（R59）改造：**死区从来不在按钮上，而在坞自己的内边距**。用户说「更有问题了。不美观，点击也没反应。」——这是同一句话的第四次。
  ① **算一遍就看见了**。坞高 144px = `padding 5×2 + 五行×26 + 间隔 1×4`。最外圈那 5px 属于 `.nw-dock` **这个 div 自己**：它 `cursor:auto`、没有任何点击处理。鼠标瞄准第一行按钮的上沿，命中的是这圈内边距——光标显示箭头，点击被吞掉。「上半部分是箭头」和「点了没反应」是**同一个原因**，而且它从来不在按钮上。这也是前五轮（R54d 透明伪元素层 → R54f 收回 inset → R54g 换真元素 → R56 矩形盒子 → R58 玻璃板）全部无效的原因：每一次都在改那五个按钮，而病灶在外壳。教训写在这里：**一个给子元素画框的容器，不许在子元素之间拥有可被命中的面积。**
  ② **修法是让坞不留任何「属于自己的」像素**。`padding:5px`→`0`、`gap:1px`→`0`；`.nw-dock-btn` 加 `flex:1 1 0` 并把 `padding` 从 `0 8px` 放宽到 `0 12px`，五行从条的上沿一直铺到下沿。原来内边距提供的视觉内缩，改由胶囊自己承担：`.nw-dock-btn::before` 的 `inset` 从 `0` 改成 `2px 3px`——**画出来分开，指针上无缝**。`97-theme.js` 同步（两处声明同一批属性，主题层在后面生效，不同步等于没改）。
  ③ **顺手拆掉自己埋的两个雷**。`backdrop-filter:blur(8px)` 删掉：它强制独立合成层，而合成层正是「命中测试说不清」时最不该新增的变量；观感上它也不是玻璃，是纸上一团灰雾。`z-index` 从 `--nw-z-float`(10) 提到 `--nw-z-panel`(20)，和其它面板同一层。底色从 42% 提到 72%、静止透明度 `.5`→`.62`、hover 直接实色。
  ④ **两条审计同时升级，并都做了变异测试**。`verify-dock-hit.mjs` 原来的「stretch 需要 padding」断言在 R59 之后是**反的**（现在要求 stretch 且要求零 padding/gap/flex 增长），已整段重写；`probe-dock.mjs` 原来断言抽屉有 `backdrop-filter`，现在断言它**没有**，另加「坞自身不得有 padding/gap」。变异测试：把 `padding:5px;gap:1px` 塞回主题层，两个脚本立刻各自报错，改回来复绿。
  ⑤ **审计脚本自身的一个盲点也被 R59 修掉**。`rules()` 的正则从上一个 `}` 起算选择器，会把规则上方的 CSS 注释并进 `sel`，于是所有 `s === '.nw-dock'` 的精确匹配一直只命中了响应式文件里的单行规则，主体规则被漏检——`align-items:stretch` 多年来就这样溜过去。现在解析前先剥注释。`probe-dock.mjs` 也踩了同一类：注释里的散文（「there is no pixel of .nw-dock left between them」）被当成规则体，导致断言在**描写修复的那句话**上报错。修法是逐条判 `/\*\//` 而不是全局剥注释——全局剥会误伤 JS 字符串，实测直接把整个对话框注册表吃掉了。
  ⑥ **模板字符串陷阱第八次**。CSS 注释里写反引号会截断模板（`90-app.js` 与 `97-theme.js` 各踩一次），`node scripts/tick-scan.mjs client/src/<file>` 定位后改掉。
  `client.js` 重建为 21 段 **1069285 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit`、`verify-dialog-kinds`、`verify-read-spread`、`probe-dock` 全过。

- 第六十轮（R60）改造：**形态改回收起式悬浮坞，R59 的结论原封不动带过来**。用户说「还是改回悬浮坞吧」。
  ① **回到 FAB + 展开菜单**。R57 把五个动作摊成五枚常驻单字，用户用了几天之后要收回原样。`Dock` 重新有 `open` / `onToggle`，新增 `dockOpen` 状态（不持久化——重启就自己弹开会盖住段落），点圆钮从上方长出五行、选中任一行自动收起，`Esc` 之外的关闭方式是再点一次圆钮；圆钮图标在展开时旋 90° 并变成叉。
  ② **R59 的病根在 FAB 形态下同样成立，所以结构不变**。`.nw-dock` 仍然 `padding:0;gap:0;border:0;background:none`——它不许拥有任何可被命中的面积。收起时坞就是圆钮那 52×52 的盒子，展开时就是菜单和圆钮严丝合缝叠起来的一列。如果菜单行之间留了缝、或者容器自己画了底色，那一圈就是下一个「上半部分是箭头」。
  ③ **圆的形状照旧是画出来的，不是盒子自带的**。`.nw-dock-fab` 是 52×52 的方形透明盒子（`border-radius:0`），圆由 `::before` 画；`::before` 是 `pointer-events:none`，子元素 `.nw-dock-fab > *{pointer-events:none}`。行胶囊同理：盒子矩形，`::before` 画 `inset:1px 0` 的纸色胶囊。**淡也落在画出来的那一层**——收起时 `::before` 是 62%，悬停/展开时 100%；如果淡的是容器，整枚按钮会跟着一起变得点不着。
  ④ **审计脚本按新形态重写，不保留过期断言**。`verify-dock-hit.mjs` 的 R57 那批「静止显示单字、悬停变全名」已经不再描述这个 UI，整段删掉而不是放宽；新不变式是：`.nw-dock` 与 `.nw-dock-menu` 不许有 padding/gap/border/background，`nw-dock-btn` 与 `nw-dock-fab` 两个可点盒子都必须是 `border-radius:0` 且形状由 `::before` 画、子元素 inert，FAB 必须真的被渲染出来，且 `::before` 有静止透明度并在悬停/展开时回到 1。变异测试：把 `padding:4px;gap:2px` 塞进主题层的 `.nw-dock`，立刻报 2 条 FAIL，改回复绿。
  ⑤ **主题层同步**。`97-theme.js` 的坞段整段换成 FAB 版本（`right:24px;bottom:68px`、零内边距、圆钮 52px、菜单行 36px），并留了注释：「将来谁再给这个容器加一圈边框，下一轮就要重新查一次箭头」。
  ⑥ **触摸屏**。`98b-responsive.js` 的 `@media (hover: none)` 分支删掉缩写相关规则（菜单行本来就带完整名字），只保留「圆钮常亮」——没有 hover 时 62% 的圆会让人以为它是禁用的。
  `client.js` 重建为 21 段 **1066488 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-dock-hit`、`verify-dialog-kinds`、`verify-read-spread`、`probe-dock` 全过。

- 第六十二轮（R62）改造：**遮挡源拆除，坞回到原位**。用户把第三方悬浮球关掉了，并要求「悬浮坞回到
  之前没改悬浮坞时候的样子」。
  ① **位置全部撤回**。`90-app.js` `.nw-dock` 从 `bottom:104px` 回 `bottom:60px`（沉浸 `72px` → `22px`，
  `right:20px` → `22px`）；`97-theme.js` 从 `bottom:110px` 回 `68px`；两个窄屏断点（`@container nw
  (max-width:980px)` 与 `@supports not (container-type)` 里的 `96px`）回 `52px`；`98b-responsive.js`
  两处（`96px` → `52px`、`92px` → `46px`）同样回退。R61 的视觉微调（菜单阴影与圆角、圆钮那圈柔光、
  几个 `color-mix` 百分比）**保留**——那是观感改良，和避让无关。
  ② **审计第 5 节改写而不是删除**。`SAFE_FLOOR = 80` 这条不变式的前提是「右下角有别人的球」，球没了，
  它就会反过来禁止用户要的那个位置。新的不变式只守真正还成立的部分：每个定位 `.nw-dock` 的规则都必须
  带一个**非零**的 `bottom`——`bottom:0` 等于把圆钮摁在窗口边缘的缩放手柄和托盘浮层底下，那种坏法和
  「按钮又点不动了」在表面上没有区别。现在的输出是「every placement carries a real bottom offset
  (46, 52, 52, 52, 60, 68px across breakpoints)」。
  ③ **保留的是判断方法，不是那个数字**。README 里「离底边 104px」换成一段判据：如果哪天它又点不动，
  先看屏幕右下角有没有别的程序的置顶悬浮球。CHANGELOG 里 R61 的五轮空转记录不删——那五轮的收获不是
  某个 CSS 属性，而是「点击没反应」要先问「那个位置在桌面层面是什么」。
  `client.js` 重建为 21 段 **1067693 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，
  `verify-dock-hit`（位置断言已改写）、`verify-dialog-kinds`、`verify-read-spread`、`probe-dock` 全过。

- 第六十一轮（R61）改造：**「点了没反应」查到最后，病灶不在插件里；坞的位置因此上移**。
  ① **五轮 CSS 都在追一个不属于自己的 bug**。用户报「读一遍按钮上半部分显示箭头」「点击没反应」，
  R54c（去掉悬停位移）、R54d（加透明命中层）、R54f（收回越界的 1px）、R54g（伪元素换成真元素）、
  R56（矩形盒子 + 伪元素画胶囊）依次落码，每一轮静态审计全过、用户复测照旧失败。最后用户截了一张
  **桌面**上的图：在那个位置右键，弹出的是「打开桌面端 / 开始全部任务 / 暂停全部任务 / 查看传输列表 /
  设置 / 隐藏悬浮球 / 取消置顶」——那是另一个程序的**置顶悬浮球**，浮在整个桌面上，正好压在应用窗口的
  右下角。指针和点击都是它接走的。插件这边的 CSS 从头到尾没有问题，R59 找到的容器死区是真实的缺陷
  （值得修），但它不是用户看到那个现象的原因。
  ② **可迁移的结论：靠 CSS 赢不了一个置顶的窗口**。`z-index` 只在同一个文档里排序，管不到别的进程；
  `cursor` 是谁的盒子谁说话。所以能做的只有**避开**——把一个第三方程序随时可能占据的区域当成禁区。
  ③ **坞上移**。`90-app.js` `.nw-dock` 从 `bottom:60px` 抬到 `bottom:104px`，圆钮（52px）落在离窗口底边
  104..156px 之间，让出脚下那条被托盘助手和下载工具占据的带子；沉浸模式 `bottom:72px`。`97-theme.js`
  同步抬到 `110px`，两个窄屏断点（`@container nw (max-width:980px)` 与 `@supports not (container-type)`
  里的 `bottom:52px`）改成 `96px`，`98b-responsive.js` 的两处（`52px` → `96px`、`46px` → `92px`）同样上移。
  **窄屏断点是最容易漏的**：它们写着 `bottom:52px`，改动主题层之后看起来「主规则已经抬高了」，
  但在小窗口里生效的偏偏是这些覆盖规则，坞会原地不动地回到被遮挡的位置。
  ④ **审计加一条位置不变式**。`verify-dock-hit.mjs` 新增第 5 节：收集**所有**定位 `.nw-dock` 的规则
  （含每一个断点）里的 `bottom`，取最小值，低于 `SAFE_FLOOR = 80` 就 FAIL，报错文字直接写明
  「这一带是 always-on-top 悬浮球的地盘，插件这边再怎么改命中区都赢不了」。变异测试：把窄屏那处改回
  `bottom:46px`，当场报 `bottom:46px puts the 52px circle inside the bottom 80px of the window ...`，改回复绿。
  ⑤ **文档同步**。README 的坞段落补上「离窗口底边 104px 而不是贴着角」以及为什么；CHANGELOG 记下这一轮
  真正的收获不是哪个 CSS 属性，而是**下次遇到「点击没反应」要先问一句「那个位置在桌面层面是什么」**。
  `client.js` 重建为 21 段 **1067799 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，
  `verify-dock-hit`（新增位置断言）、`verify-dialog-kinds`、`verify-read-spread`、`probe-dock` 全过。

- 第五十三轮（R53）改造：**标注不再「浮在字上」，而是搬进页边；输入框缩成便签；一条线只存在一次**。用户这一轮提了五件事，其中三件是同一个病的不同症状：标注的入口、出口、标识原本都长在正文里。
  ① **阅读页点批注，输入框太大、而且不在点的地方**。原来按「离点击最近的那一行」的右下角定位，点在句子中间时框会飘到行尾十几厘米外；宽度 176px 里还塞着 28px 高的文本框。现在：`openMark()` 直接用 `ev.clientX / ev.clientY`，`placeNear(at,w,h)` 把便签贴在点击处右侧 16px（右侧放不下就翻到左边），top = `y - 12` 并夹在视口内；宽度收到 **196px**、内边距 5px、文本框 `rows=1` 且随字数自动长高（24→64px，三行半封顶），按钮收成「取消 / 保存」。**新建批注也不再弹 `NW.ui.prompt`**（那是屏幕正中一块大面板），改成同一张便签贴着选区开：`openComposer()` 只记选区，`saveComposer()` 才落库，取消不写。两条路径都支持 Ctrl/⌘+Enter 直接保存。
  ② **写作区选字不该自己弹「下划线 / 删除线 / 批注」**。R52 那条浮在选区下方的 `.nw-mark-pick` 小条整套删掉（state / ref / openMarkPick / closeMarkPick / syncMarkPick / 三处调用 / 一段 CSS）。标注入口改成左上动作胶囊里的一支铅笔：点开一张 146px 宽的小菜单，三行各带一段「样本线」，选之前就能看见会画成什么样；菜单顶端一行显示将被标注的那十几个字，没有选区时写「先选中一段字」并禁用三行。菜单与菜单项一律 `onMouseDown` preventDefault，textarea 不失焦，选区就一直亮着。**看批注**则照旧点那一行字：`markAtPoint()` 用镜像层 `<mark>` 的 `getClientRects()` 做点命中，命中就开那张只读卡。
  ③ **小标识还是挡字——这次不修位置，改结构**。只要标识和文字共处一行，行距一紧就会压到某个字；字数一多还认不出它指的是哪句。所以正文里**不再插入任何节点**：`splitByMarks()` 去掉了 `tail` / `badge` 与 `.nw-mark-dot`，编辑器 `rebuildHighlights()` 同样不再插零宽锚点。取而代之的是**页边批注签**：读视图在 `.nw-read-stage` 上叠一层 `.nw-read-gutter`，编辑器在 `.nw-stack` 里放一层 `.nw-mark-gutter`，`paintGutter()` 取每条带批注的标注在当前页 / 当前文档里的首个行盒，把一枚 14×10px 的「三点小签」摆在那一行**右侧的页边空白**里（读视图 x 固定在栏宽右缘 +6px，编辑器 x = `stackW - 22`，都落在 `--nw-pad-x` 之内，正文一个像素不占）。同一行两条批注的签自动下移避让。签是真按钮：阅读页点它等于点那条线，写作页点它直接开卡。正文里没有角标，遮挡从结构上消失。
  ④ **划线能重复划，删除要删多次**。两个根因：一是 db 没有去重，同段可以存两行，第二行画在第一行上完全看不见却删不掉；二是编辑器 `createMarkOf` 造的 draft **没带 `chapterId`**，被 `db.cleanMark` 直接丢掉，所以写作区画的线其实一条都没存住。现在 db 层按「同章 + 同起止」合并：`createMark` 命中已有行就把新类型 / 新批注并进正主、删掉兄弟行，`updateMark` 同步刷新所有同段行，`deleteMark` 一次删净同段全部行；编辑器 `createMarkOfSelection()` 本地同段只留一条（同类型只把卡片重新开出来，不同类型就地改 kind），`removeMarkOf()` 也按段删，draft 补上 `chapterId`。
  ⑤ **阅读页翻页像「隔着一个框在挪」**。原来 `scrollToPage(...,'smooth')` 把右边那一栏整块横向拖进视野，读者看到的是画面平移。现在 `go()` 改成 `data-turn="1"` → 110ms 淡出 → `scrollLeft` 瞬时换页（临时 `scrollBehavior:auto`，否则「瞬时」也会被浏览器补成 300ms 滑动）→ 淡入；键盘 ←/→、滚轮、点左右半屏、页码都走同一条路，`prefers-reduced-motion` 下时延归零。
  `client.js` 重建为 21 段 **1031085 字节**，`verify-client-load` 仍报 `inject=["slots","layout","locale"]`，`verify-host` 219 项全过。手机端是独立原生 App，不受影响。
- 第五十三轮补丁（R53b）：**同一行的批注签能分辨了；翻页从「换一张」改成「滑过去」**。用户对着 R53 的成品提了两点，都是「还能更好」而不是「坏了」。
  ① **同一行挂两条批注，两枚签长得一样**。R53 的签是 14×10 的三点小方块，同一行有两条时第二枚下移 13px——下移之后就只剩两枚一模一样的方块，谁也认不出哪枚对哪句。现在三处一起改：**签上写序号**（按 `start` 排、章内唯一，字号 9px、等宽数字、品牌底色反白），看见「3」就知道是本章第 3 条；**被下推的签画引线**（`[data-shift="1"]::before`，从签左侧向上折回自己那一行，长度 = 下移量，55% 透明），序号说「第几条」、引线说「哪一行」；**悬停点亮所指句子**（`mouseenter` 给同 id 的 `.nw-mark` 加 `data-hover="1"`，底色 14% 品牌色），鼠标一扫就对上号。三处都同步到了写作区（`60-editor.js` 的 `.nw-mark-side` / `paintGutter()` / `.nw-hl .nw-mark-*[data-hover="1"]`）。顺手补了个小坑：`paintGutter()` 重画前先扫掉残留的 `data-hover`，否则改完字会有一句话一直亮着。
  ② **翻页还是「隔着一个框在挪」**。R53 的 110ms 淡出淡入虽然不再平移，但换页那一下仍是「整块换掉」，读者看到的是一张纸被另一张纸盖住。现在改成**真的横向滑动**：`slideToPage(index)` 用 rAF 逐帧写 `flow.scrollLeft`，`dur = clamp(190, 150 + 距离×0.06, 320)`，缓动 `1-(1-t)⁴`（起步快、收尾慢，像翻书时手松开那一下）；滑动期间 `[data-turn="1"]` 只把正文压到 85% 透明度（字从纸面底色里浮出来，不再有白底方块），页边签淡出（它挂在某一行上，跟着跑会抖）。滚轮 / 键盘 ←→ / 点左右半屏 / 页码全走同一条路；`scroll-behavior` 从 `smooth` 改成 `auto`（CSS 的 300ms 匀速会和 rAF 打架），`clearTurns()` 负责在连续翻页时取消上一段 rAF 并还原 `scrollBehavior`；`prefers-reduced-motion` 下直接跳页。
  `client.js` 重建为 21 段 **1040005 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
- 第五十三轮补丁（R53c）：**铅笔按钮撤了，入口改右键；引线撤了，改句子自己变色；红框修掉；翻页放慢**。用户对着 R53b 提了四点。
  ① **编辑页左上角那颗铅笔按钮去掉**。它常驻在纸面上方，为一件事关标注的低频动作占一格视觉重量，用户点名不要。现在标注入口改成**右键**：选中一段字按右键 → 在**指针旁边**弹出那张小菜单（`.nw-mark-menu` 的 `left/top` 由 `openMarkMenu(ev)` 按 `.nw-surface` 坐标算，先右后左、先下后上夹在纸面内，152×132 避让）；没选中就原样放行，浏览器自己的复制/粘贴菜单照旧；右键直接点在一条已有线上时按「看批注」处理，直接开卡。`toggleMarkMenu()` 与 `.nw-actbtn[data-on="1"]`、菜单开合 effect 里的 `.nw-actbtn[aria-haspopup]` 选择器一并删除。
  ② **页边签不再画引线**。用户说那条细线在页边空白里看不出来，两条签上下错开时更像装饰。`.nw-mark-side[data-shift="1"]::before` 与 `paintGutter()` 里的 `baseY` / `data-shift` / `--nw-side-lead` 全部删除（阅读页与写作区同步）。替代方案是让**句子自己回答**：鼠标停在签上、或点开一条批注时，它指的那句明显变色——`[data-hover="1"]` 从 14% 提到 **26% 品牌色 + 2px 品牌底边**，`[data-active="1"]`（点开时）提到 **30% + 1px 底边**。签上的序号仍说「第几条」，句子亮起来说「哪一行」，两个信号配合。
  ③ **方向键翻页闪红框**。焦点在 `.nw-read-flow` 上（`tabIndex:-1`，为的是让方向键不落进正文），而 `05-css.js` 的通用规则 `.nw-root :where(button,a,input,select,textarea,[tabindex]):focus-visible{outline:2px solid var(--nw-brand)}` 给它描了品牌色焦点环——翻页时那一圈红边就是它。修法是用更高特异度盖掉：`.nw-read-stage .nw-read-flow:focus, .nw-read-stage .nw-read-flow:focus-visible{outline:none;box-shadow:none;}`（`:where()` 那条特异性为 0，两层类足够）。翻页容器不是控件，键盘用户也不需要在这里看焦点环——方向键本身就会翻页。
  ④ **翻页太快、没有动画**。R53b 的 `dur = clamp(190, 150 + 距离×0.06, 320)` 一眨眼就过去了，缓动 `1-(1-t)⁴` 起步太猛。现在整页翻 **560ms**，缓动换成 **easeInOutCubic**（`t<0.5 ? 4t³ : 1-(-2t+2)³/2`，两头慢、中间快，像纸页被手指推过去）；吸附（手指松开后那点回正）走同一个函数，时长按「这次要走多远 / 一页多宽」缩放——走满一页 560ms，走几像素仍约 190ms，不会让对齐也等半秒。`quietRef` 跟着 `dur + 140` 动态设，滑动期间不误判页码。
  `client.js` 重建为 21 段 **1039901 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
- 第五十三轮补丁（R53d）：**删除线底下那道多余的下划线修掉了**。用户报「编辑页面添加删除线会附带下划线」，同时问「下划线功能和批注功能重复不」。
  ① **根因不是删除线画错了，是它没清干净继承来的阴影**。编辑器正文上面盖着一层镜像（`.nw-hl`），每个标注节点都同时带两个类：`.nw-hl-mark`（AI 建议高亮那套的通用类）和 `.nw-mark-<kind>`。通用类自带一条底边：`.nw-hl .nw-hl-mark{background-color:var(--nw-hl-bg);box-shadow:inset 0 -1.5px 0 var(--nw-hl-line);}`（`60-editor.js:546`）。下划线和批注各自重写了 `box-shadow`，删除线只写了 `background-color:transparent`，于是那条 1.5px 的底边原封不动留在了身上——中线之外又画一道线，看着就是「删除线附带下划线」。修法是给 `.nw-hl .nw-mark-strike` 补 `box-shadow:none;`，并在注释里写明根因，免得下次又被继承链坑。
  ② **同一个病还有两个潜伏的触发态**。`[data-active="1"]`（点开这条线）与 `[data-hover="1"]`（鼠标停在页边签上）原来把三类标注写在同一个选择器组里，都补 `inset 0 -1px / -2px 0` 的底边——也就是说，删除线只要被点开或悬停，底下照样会冒出下划线。现在拆开：underline / comment 保留底边，strike 单独写一条只换底色、`box-shadow:none`。阅读页（`62-read.js` 的 `.nw-mark-strike[data-active="1"]` / `[data-hover="1"]`）与写作区（`60-editor.js`）同步。
  `client.js` 重建为 21 段 **1040682 字节**，`verify-client-load: ok`，`verify-host` 219 项全过，`verify-docs` 41 过 3 失败（沙箱 `spawn EPERM` 的 python-docx 检查，与本轮无关）。
- 第五十三轮补丁（R53e）：**文字只属于批注**。用户选了「批注独占文字」这个收法，回答「下划线和批注重复不」。
  ① **重复的不是按钮，是模型**。三类的本意是三件事：下划线「这句好」（只指认）、删除线「这句要删」（一个决定）、批注「这里有话」（必须有内容）。但 `note` 和 `kind` 是两个独立字段，于是「下划线 + 批注」成了合法状态——划一条线、点它、选「批注」、写字，这句话就同时是一条下划线（线还在字下）和一条批注（`paintGutter` 的入选条件是 note 非空或 kind==='comment'，页边冒出一个签）；再点它，因为 kind 还是 underline，弹出的又是「删除/批注」，而不是直接给看刚写的那句。同一句话、两个身份、两套入口。
  ② **规则钉在写入端**：`10-db.js` 的 `cleanMark()` 里，`note` 非空即 `kind='comment'`（`comment` 允许暂时没字，那是刚建出来还没写的那一下）；`listMarks()` 出库时把「有字但 kind 不是 comment」的老行读成 comment（老书架不用迁移，规则对 UI 永远成立）；`createMark()` 合并兄弟行后同样以文字定 kind；`updateMark()` 两个方向都成立——写进字就升成 comment，把字清空（且没同时指定 kind）就退回 underline。
  ③ **界面跟着改**：阅读页点一条线，`kind==='comment' || note 非空` 就直接开编辑框（不再问一次）；下划线/删除线的 picker 按钮文案改成「写批注」；编辑框在「本来不是批注」时多一行灰字「保存后这句话就是一条批注」，说清楚这一步会让线本身变样。写作区 `createMarkOfSelection()` 遇到「有字的线」不再允许降级（只开卡片，线不动），避免存进去又被判回 comment 的闪一下。`markCard` 对下划线/删除线不再写「没有批注」，改显示「下划线 / 删除线」，并新增 `.nw-mark-view-kind`。页边签的入选条件统一收成「必须有字」（`62-read.js` 与 `60-editor.js` 的 `paintGutter()`），空批注不再留一枚什么都不指的签。
  ④ 顺带把删除线那个 bug 的三个触发态（常态 / `[data-active]` / `[data-hover]`）全部补齐 `box-shadow:none`，见上一条。
  `client.js` 重建为 21 段 **1044153 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
- 第五十三轮补丁（R53f）：**点下划线 / 删除线只留一个「删除」**。用户说「"知道了"和重复划线内容就不要了」。
  ① **引文是重复的**。那张卡的第一行 `markView.mark.quote` 就是刚点的那句字，而它此刻正亮在正文里、就在卡片旁边——同一句话抄两遍，其中一遍还只有 40 个字（`slice(0, 40)` 截断），长句会被切在中间。删掉。
  ② **「知道了」是为一张不该挡路的卡而多出来的动作**。卡本身是点出来的，点别处就收（`handleMarkClick` 的 else 分支、滚动、Esc 都关），根本不需要一个专门的关闭按钮；它占着按钮行的左半边，把「删除」挤成两半。删掉。
  ③ **批注那条路径不动**。批注卡上引文不是重复（正文里那一条是线不是字，用户看的就是这条线指向哪句）、note 是这卡存在的理由、「知道了」对一段可能很长的话是合理的收尾。所以用 `markIsLine`（`kind !== 'comment'`）分支：线类卡片引文 / note / 「知道了」全渲染 `null`，只剩「删除」；批注卡片保持引文 + 正文 + 「知道了 / 删除」。
  ④ **卡片尺寸跟着收**。`.nw-mark-view[data-compact="1"]` 收成 `width:auto`、`padding:4px`、按钮 `flex:0 0 auto;padding:0 12px`——一个 22px 高的按钮摊在 200px 里，右边空出一大片，看着像没加载完。`openMarkView()` 的避让尺寸也分两种：线类按 **92×34**、批注按 200×150 算，否则只剩一个按钮的小卡会按 200×150 去躲，落在离点击处很远的地方，看着像点错了地方。`.nw-mark-view-kind` 这个只为「下划线 / 删除线」字样存在的规则一并删除。
  `client.js` 重建为 21 段 **1044773 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
- 第五十三轮补丁（R53g）：**批注也只剩它自己；没有保存键，点别处就收起（并已保存）**。用户说「批注也是不要再重复显示标注内容和知道了，阅读页面的批注编辑后自动保存，不用保存按钮和取消按钮，鼠标点击其他任何地方，批注输入框收起来」。
  ① **写作区的批注卡也去掉了引文和「知道了」**。R53f 只收拾了下划线和删除线，批注那条路径还留着「引文 + 正文 + 知道了 / 删除」四件东西。可是批注卡的位置就是贴着那条线的，正文里那句话正亮着，引文仍是把同一句话说了两次；「知道了」在 R53f 里已经被论证为多余（点别处、滚动、Esc 都收）。现在 `markCard` 只剩 `nw-mark-view-note` 正文 + 「删除」——引文、`nw-mark-view-kind`、「知道了」全部渲染 `null`，`markIsLine` 变量保留但只用来决定要不要渲染 note（线类连正文也没有）。
  ② **阅读页批注改成打字即存**。原来「取消 / 保存」两颗按钮，意味着一次「我改两个字」要走三下（选中、改、点保存），而且忘了点保存就等于没改。现在编辑框只剩一颗「删除」：`onChange` 里 `scheduleNote(id, body)` 做 700ms 防抖落库，`onBlur` / Esc / 收起前 `flushNote()` 补最后一次。**为什么不是每键都存**：`onNote` 背后是 `db.updateMark → notify → 应用层 refreshMarks → marks 换新 → 本组件 body 重新把整本书拆一遍段落`，二十万字的稿子两万行，每按一个字拆一次会当场卡住。700ms 合并既保住「不用点保存」，也不让打字变成重活。
  ③ **新建批注也一样**（`composerBox`）。`openComposer()` 只记选区，`scheduleComposer()` 700ms 后 `commitComposer()`：第一次出现非空文字时才 `p.onMark` 建行，并把它返回的 id 回填进 `composerSaveRef`，之后就是普通的改批注；空着关掉当没写过，不留一条「有批注底色却没有签」的空行。卸载时 `flushNote()` + `commitComposer()`，关掉整个「读一遍」也不会丢最后一句。
  ④ **点别处收起，而且是任何地方**。只在 flow 里监听不够——顶栏、页脚、页边签、窗口外都算「其他地方」。所以在 `document` 上做捕获监听（`pointerdown`，不是 `click`：点击顺序是 pointerdown → blur → click，等 click 的话 textarea 的 blur 会先保存一次、框还会在按下与松开之间闪一下）。命中 `.nw-mark-pop`（输入框自己）、`.nw-mark[data-mark]`（正在编辑的那条线的锚点）、`.nw-mark-side`（页边签）时不收，其余一律先 `flushNote()` / `commitComposer()` 再清 `picked` / `editing` / `composer` 与所有 `data-active`。**收起 = 保存**，不是放弃。顺带补了一个副作用：这一下按下既然是在「把框点掉」，`pointerup` 里就不再判翻页（`dismissedRef`），否则点一下空白会同时收框和翻页。
  ⑤ **删除要先把待写的作废**。`dropNote()` 在 `onUnmark` 之前清掉 timer 和 dirty，否则「刚改完就删」会在删掉之后又把那一行写回来。
  `client.js` 重建为 21 段 **1050495 字节**，`verify-client-load: ok`，`verify-host` 219 项全过。
- 第五十二轮（R52）改造：**写作区也能划线了，点一下就能看，单击就开**。
  ① **写作区没有创建标注的入口**。R51 让写作区能「看」标注，却仍然只能在「读一遍」
  里「画」——所以用户的第一反应是「编辑页面还是不能删除线和批注」，因为手上根本没有
  可点的线。现在在正文里拖选一段字（≥2 字），选区末尾下方会浮出一条「标一下」小条：
  下划线 / 删除线 / 批注。点一下就地成线，并立刻在这条线下面张开那张小卡。
  画线走 `marksRef` 先画、再 `onMarkCreate` 落库——等 IndexedDB 回来才画会让人觉得没点上。
  小条只在 textarea 有焦点、选区真的存在时出现；滚动纸面、点别处、选区塌掉都会收走。
  ② **单击开不出来，得双击**。根因有两个：一是命中判定读 `ta.selectionStart`，而点击那一刻
  光标未必已经落好；二是点划线**最后一个字**的右半边时，光标落在字之后，`offset < end`
  判定为「不在线内」。现在先用 `markAtPoint(ev)` 拿镜像层里 `<mark>` 元素的
  `getClientRects()` 做点命中（跨行、跨栏都准），再退回偏移判定并容忍 `offset === end`。
  拖选结束的那次 click 用 `pointerDownRef` 的位移区分，不会误开卡片。
  ③ **删除要点两次才生效**。卡片里的「删除」原先直接调 `onMarkRemove`，等库回来才重画；
  现在先改 `marksRef` 立即重画，再落库，点一下线就没了。
  ④ **`createMark` 会换掉 id**。编辑器为了即时显示先造了 `mk-…` 的 id，而
  `createMark` 内部又用 `uid('mark')` 生成新 id，于是刚打开的那张卡指向一条不存在的
  记录，删除自然无效。现在 `createMark` 认调用方给的 id。
  ⑤ **批注角标挪到字尾右上角**。原来贴字腰右侧（`bottom:.28em`），行距紧的时候压住
  下一行开头的字——用户说「有点遮挡文字」。改成 `top:-.86em`，落在行距的空白里，
  字本身一个像素不动。读视图与编辑器镜像两处同步。
  ⑥ **读视图的批注框贴着那段字开**。原来按鼠标坐标开，点哪开哪，还会飘到屏幕边上；
  现在取这条标注所有行盒里离点击点最近的那个，居中开在它下面，宽度收到 176px、
  文本框最小高 28px——是张便条，不是一块面板。
  `client.js` 重建为 21 段 **1009393 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
  用真实 Chrome + CDP 验证过：单击划线任意位置都开卡、批注原文可读、删除立刻生效、
  拖选后「标一下」出现、滚动后收起。手机端是独立原生 App，不受影响。
- 第五十一轮（R51）改造：**写作区能看标注了，读视图的批注窗也收小了、能删了**。
  ① **批注窗太大**。上一轮把它缩到 220px，但里面还塞着一个 `min-height:56px` 的
  文本框和一行按钮，读起来仍像一块面板。这轮把写批注那一版单独收窄到 200px、
  文本框最小高 32px、内边距 3px，`resize` 关掉——它是一张便条，不是一块画布。
  ② **批注窗删不掉**。它原先只有「取消 / 保存」两个按钮；想扔掉一条批注得先关掉窗、
  再去点那条线，而线在窗下面点不到——于是那条批注永远删不掉。现在窗里第一个按钮就是
  「删除」（红字），点它 `onUnmark(id)`，窗和线一起消失。
  ③ **写作区看不见标注内容**。以前标注只在读视图里能点开，写作时只有一道线，
  写过什么得切回「读一遍」才知道。现在在正文里点一下任意一条划了线的字，
  就在那一行下面浮出一张小卡（`.nw-mark-view`，200px）：引文、批注原文、两个按钮
  「知道了 / 删除」。**这里只读**——写作区是写字的地方，改批注回读视图改，所以卡里
  没有输入框。卡片挂在 `.nw-stack` 里（不是视口固定定位），所以它跟着纸面滚动；
  位置用 `measureCaret()` 量出点击那一行的 `lineTop`，长段落换行时也不会跑到段首去。
  点空白处、换章、按 Esc 都会收起；标注在别处被删掉时它也会自己消失。
  ④ 编辑器多一个 `onMarkRemove` prop（`90-app.js` 里接 `removeMark`），
  `markAt(offset)` 这个早就写好但一直没人用的函数终于用上了——textarea 是单个节点，
  只能按偏移找标注，没法用 `closest()`。
  `client.js` 重建为 21 段 **996496 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
  手机端是独立原生 App，不受影响。
- 第五十轮（R50）改造：**标注变成可以点、可以就地改的小东西**。
  ① **小标识改成一个「小方框里三个点」**。上一轮那个墨点只说「这里有东西」，说不清是
  什么；方框里三个点是便条的意思，和别处的批注图标同一个意思。框里三个点用三枚
  `radial-gradient` 画，不引入图标、不多一个 DOM 节点。读视图
  （`.nw-mark-dot::after`）与编辑器镜像（`.nw-hl .nw-mark-dot::after`）两处同款。
  ② **批注不再是一种标注类型，而是任何一条线上的附言**。以前只有「批注」那种标注能写话，
  现在下划线和删除线也能带一句；角标跟着 `note` 走，不跟着 `kind` 走
  （`splitByMarks` 与 `rebuildHighlights` 里都改成 `badge: !!note || kind==='comment'`）。
  ③ **点已有的下划线或删除线，就在点的位置浮出两个小按钮：删除 / 批注**。
  删除直接把那条线去掉；批注就在点击处旁边张开一个小编辑框，不再拉到屏幕底边那块大面板。
  位置由 `anchorOf(x, y, w, h)` 按鼠标坐标算，优先向下张，下面放不下就翻到上面，
  并夹在视口内。点批注类型则直接开编辑框——它存在的意义就是那句话。
  ④ **编辑框收小**：面板宽度 280 → 220px，内边距 `--nw-sp-2` → 6px，按钮高 26 → 24px，
  文本框最小高度 56 → 44px，贴着鼠标出现，不再是一块大白板。
  ⑤ 顺手补了 `prefers-reduced-motion` 下 `.nw-mark-pop` 的动画关闭。
  `client.js` 重建为 21 段 **988830 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项全过。手机端是独立原生 App，不受影响。
- 第四十九轮（R49）改造：**删除线加粗、批注的小点真的落在字尾、批注能改**。
  三件事都是上一轮交付后在真机上看见的问题。
  ① **删除线太细**。原来 `text-decoration-thickness:1.5px`，在 20px 的行高下细得像渲染
  毛刺，读者分不清是自己划的还是屏幕的毛病。改成先写 `2px` 兜底、再写
  `max(2px, .09em)`——小字两像素，放大字号时线跟着字一起长粗。读视图
  （`62-read.js`）与编辑器镜像（`60-editor.js`）两处同步改，否则写完读到的是两条粗细不一的线。
  ② **批注的小标识没有浮在所划文字的末尾**。上一轮把它挂成
  `.nw-mark-comment[data-tail="1"]::after{left:100%}`，而 `left:100%` 参照的是**行盒**的
  末尾，不是文字的末尾：批注一跨行，点就跑到上一行的行尾去；跨栏时还会被栏边界裁掉。
  现在改成在片段的最后一个字后面插一个零宽零高的 `inline-block` 锚点
  （`.nw-mark-dot`），角标以它为基准绝对定位。锚点不占任何排版空间，所以分页、字距、
  换行一个像素都不变——这是整个标注功能的前提。镜像层同样处理（一个 range 一个
  `mark`，锚点插在它后面）。
  ③ **批注能改**。读视图的批注窗本来就有「改批注」按钮，但它调的是
  `NW.ui.promptAsync` —— UI 层导出的名字是 `prompt`，`promptAsync` 根本不存在，
  于是点了什么都不发生（也没有报错，`typeof` 判断直接落到了 `Promise.resolve(null)`）。
  这同时是「写一条批注」那个按钮一直没反应的原因。两处都改成 `NW.ui.prompt`。
  `client.js` 重建为 21 段 **985221 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
  手机端是独立原生 App，不受影响。
- 第四十八轮（R48）改造：**标注只剩三种，批注末尾挂一个小点，点标注不再翻页**。
  ① **删掉「待改」**。「待改」既不是「这句好」也不是「这句错」，它是一句待办，而待办应该是
  一句批注；留着一个介于两者之间的第四种颜色，只会让人在选按钮的时候先想一次「我到底想说什么」。
  下划线 / 删除线 / 批注三种够了。旧记录不丢：`cleanMark()` 把 `todo` 归一成 `underline`，
  `listMarks()` 出库时也把老备份恢复回来的 `todo` 一并改掉——旧书上的标注不能因为升级就消失。
  ② **批注的标识从行内小圆点改成末尾悬浮的小点**。原来是行内元素，会把后半行挤走，
  甚至把一个字挤到下一栏，那等于改变了分页，违背「标注永不动字」这条底线。现在读视图和
  编辑器镜像都用 `position:absolute;left:100%;top:0` 的 `::after`，零占位。
  读视图里一条批注可能跨段，`splitByMarks()` 给每片加 `data-tail`，只有真正走到批注终点的
  那一片画点，否则一条批注会冒出三个点。
  ③ **修「点标注先翻一页才弹批注」**。一次点击是 `pointerdown → pointerup → click`，
  原来 `onPointerUp` 只看位移，点在标注上位移不到 8px、浏览器选区又为空，就直接当成
  「点空白翻页」翻了一页，等 `click` 打开批注时书已经跳到下一页。现在 `pointerdown` 时记下
  这一下是不是压在标注 / 工具条 / 批注窗上，`pointerup` 里直接让开；从标注上起手往外拖
  仍然照常进入拖选标注。
  ④ 附带：点开一条标注时它会亮起来。这个高亮是直接改 DOM 的 `data-active`，
  **刻意不进正文的 `useMemo` 依赖**——否则每点一次标注就要把全书重拆一遍段，
  正是 R44 修掉的那种卡顿。
  `client.js` 重建为 21 段 **983999 字节**，`verify-client-load` 仍报
  `inject=["slots","layout","locale"]`，`verify-host` 219 项、`verify-docs` 44 项全过。
  手机端是独立原生 App，不受影响。
- 第四十七轮（R47）改造：**沉浸时右下角的按钮还在，稿子上能画标注**。
  两件事一起做，因为它们是同一个问题的两半：写的时候不想看见工具，但读完一遍想记点什么时
  又有地方可记。
  ① **沉浸模式不再把右下角的写作工具整个拿掉**。原来 `90-app.js` 里是
  `const dock = immersive ? null : h(Dock, …)`——不是 CSS 藏起来，是根本没渲染，于是全屏写作时
  校对/排版/建议/读一遍/投稿五个入口一个都不在。改为始终渲染，只用
  `.nw-dock[data-immersive="1"]{bottom:20px;right:16px;opacity:.3;}` 把它收小、变淡，
  hover 或展开菜单时恢复不透明：要它时在，不要它时不碍眼。
  ② **「读一遍」里可以选中一段字画标注**：下划线、删除线、批注（带正文的批注
  另外弹一层小窗写内容）。选中后浮出按钮的小工具条；点已有标注可以看批注正文、改它或删掉。
  标注是**按字符区间**存的（`start`/`end`，另存一段 `quote` 便于人读），不是按页、按行——
  换字号、改栏宽、改窗口大小都不影响。
  ③ **编辑时也看得见**。编辑器本来就有一层透明的高亮镜像（`.nw-hl`，在透明 textarea 背后画
  底色，供查找命中和修改建议用），标注直接复用这一层，加了 `.nw-mark-underline` /
  `.nw-mark-strike` / `.nw-mark-comment` 三种画法：下划线是 `inset` 阴影、删除线是
  `text-decoration`、批注是淡色底加一条细线和一个角标点。
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
  `client.js` 重建为 21 段 **982690 字节**，`verify-client-load` 仍报
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
