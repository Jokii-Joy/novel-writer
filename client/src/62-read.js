;(() => {
  'use strict';

  // ============================================================== 读一遍 =====
  //
  // 写作的时候人是贴着字看的，所以只看得见句子；只有把整篇拉远、变成书页、
  // 一页一页翻过去，才看得见「这是一篇小说」。
  //
  // 这个视图就是那段距离：整本书铺成纸，没有光标、没有工具栏、没有章节树，
  // 只有正文、页码和翻页。
  //
  // 实现要点
  //   * 分页用 CSS 多栏（`column-width` + `column-fill:auto`）在固定高度的
  //     滚动容器里横向溢出，翻页只是改 `scrollLeft` —— 不引入任何排版依赖，
  //     也不预先把正文切成「页」，所以窗口一改宽度就自然重排。
  //   * 栏宽与字号沿用写作设置（settings.pageWidth 之外的 fontSize/lineHeight）
  //     ，读的时候行宽与写作时一致，不会突然变成另一种版面。
  //   * 打开时先跳到当前章节所在的那一页；Esc / 关闭按钮回到写作，编辑器的
  //     选区与滚动位置原封不动（这是一个覆盖层，编辑器从未被卸载）。
  // ========================================================================

  const THEME_KEYS = { claude: 1, eye: 1, night: 1, newspaper: 1, magazine: 1 };

  // 与 60-editor.js 的占位判定保持一致：占位标题不进书页，否则每章顶上都会
  // 出现一行「新章节」。
  const PLACEHOLDER_TITLES = { 新章节: 1, 未命名: 1, 未命名章节: 1, 正文: 1, 无题: 1, 内容: 1 };
  const PLACEHOLDER_RE = /^(?:新章节|未命名章节?)\s*\d*$|^第\s*[0-9零一二三四五六七八九十百]+\s*[章节回卷幕]$/;

  function isPlaceholderTitle(title) {
    const raw = String(title == null ? '' : title).trim();
    if (!raw) return true;
    if (PLACEHOLDER_TITLES[raw]) return true;
    return PLACEHOLDER_RE.test(raw);
  }

  function numOf(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clampNum(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /**
   * 正文 → 段落。
   *
   * 作者用换行分段，所以一行一段。行首的手工缩进（含全角空格）去掉，缩进改由
   * CSS 的 `text-indent` 统一给 —— 否则排版过的稿子会缩进两次。
   *
   * 空行不当段落（段距由段落 margin 负责，留着空行会把段距翻倍），但也不能
   * 直接丢掉：中文长篇里空行常常就是「场景换了」的唯一标记，抹掉它整章会塌成
   * 一片。所以空行只转成下一段的 `gap`，由 CSS 加一份额外段距。
   *
   * 每段还带 `start`：这段第一个字在章节全文里的字符下标。标注是按全文
   * 下标存的，所以读视图要知道每段从哪儿开始，才能把标注画到对的地方。
   */
  function paragraphsOf(text) {
    const out = [];
    const raw = String(text == null ? '' : text);
    const lines = raw.split(/\r\n|\r|\n/);
    let blank = 0;
    let pos = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      const after = pos + line.length + 1;
      if (!trimmed) {
        blank += 1;
        pos = after;
        continue;
      }
      // 第一段前面的空行没有意义（正文开头本来就留白）。
      out.push({
        text: trimmed,
        gap: out.length > 0 && blank > 0,
        start: pos + (line.length - line.trimStart().length),
      });
      blank = 0;
      pos = after;
    }
    return out;
  }

  /**
   * 把一段文字按标注切开。
   *
   * 标注只能画在字的下面，不能改字，所以这里只负责把段落拆成「普通文本 +
   * 带 class 的 span」，段落的文字内容一个字都不少。
   */
  function splitByMarks(para, marks) {
    const start = para.start;
    const end = start + para.text.length;
    const hits = [];
    for (let i = 0; i < marks.length; i += 1) {
      const m = marks[i];
      const s = Math.max(start, Number(m.start) || 0);
      const e = Math.min(end, Number(m.end) || 0);
      // A mark may cross a paragraph break; each paragraph then gets its own
      // piece. R53: the little comment badge no longer lives inside the text —
      // it moved to the page margin (`paintGutter`), so a paragraph is only cut
      // into plain runs of marked / unmarked words here.
      if (e > s) {
        hits.push({
          s: s - start,
          e: e - start,
          kind: m.kind,
          id: m.id,
        });
      }
    }
    if (!hits.length) return para.text;
    hits.sort((a, b) => a.s - b.s || a.e - b.e);
    const out = [];
    let pos = 0;
    for (let i = 0; i < hits.length; i += 1) {
      const m = hits[i];
      const s = Math.max(pos, m.s);
      if (m.e <= s) continue;
      if (s > pos) out.push(para.text.slice(pos, s));
      out.push(
        h(
          'span',
          {
            className: 'nw-mark nw-mark-' + String(m.kind || 'underline'),
            key: 'm' + i + '-' + String(m.id),
            'data-mark': String(m.id),
          },
          para.text.slice(s, m.e),
        ),
      );
      pos = m.e;
    }
    if (pos < para.text.length) out.push(para.text.slice(pos));
    return out.length === 1 ? out[0] : out;
  }

  NW.CSS_PARTS.push(`
/* ---- 读一遍 -------------------------------------------------------------
   The page itself is the whole screen: one column of text per page, paged by
   scrollLeft inside .nw-read-flow. Nothing here changes the manuscript — it is
   a view, and closing it puts the writer back exactly where they were. */
.nw-read{
  position:absolute;inset:0;z-index:30;
  display:flex;flex-direction:column;
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-reading-font);
  font-size:var(--nw-fs-second);line-height:var(--nw-lh-base);
  animation:nw-fade-in var(--nw-dur, .18s) var(--nw-ease, cubic-bezier(.2,.7,.2,1)) both;
}
.nw-read-bar{
  flex:0 0 auto;display:flex;align-items:center;gap:var(--nw-sp-3);
  padding:var(--nw-sp-3) clamp(20px,6vw,64px) 0;
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-micro);
  color:var(--nw-soft);
}
.nw-read-bar-name{
  flex:1 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  letter-spacing:.08em;
}
.nw-read-bar-close{
  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:var(--nw-h-iconbtn);height:var(--nw-h-iconbtn);
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-soft);cursor:pointer;padding:0;
}
.nw-read-bar-close:hover{color:var(--nw-fg);background:var(--nw-btn-hover);border-color:var(--nw-line-soft);}
.nw-read-stage{
  position:relative;flex:1 1 auto;min-height:0;
  display:flex;justify-content:center;
  padding:0 clamp(20px,6vw,64px);
}
/* The paged column. Both lengths are written by the component because
   column-width accepts lengths only, never percentages.
   R55: they are two different numbers now. --nw-read-col is one text column;
   --nw-read-box is the page — one column when the pane is narrow, two when it is
   wide enough to open like a book (see measure()). Keeping them separate is what
   lets a spread show two columns inside one scrolling box. */
.nw-read-flow{
  position:relative;
  width:var(--nw-read-box,680px);height:100%;
  column-width:var(--nw-read-col,680px);
  column-gap:clamp(28px,5vw,64px);
  column-fill:auto;
  overflow-x:auto;overflow-y:hidden;
  overscroll-behavior-x:contain;
  scrollbar-width:none;-ms-overflow-style:none;
  /* 不用 CSS 的 smooth：翻页的位移由 slideToPage() 用 rAF 自己推，浏览器再补
     一段 300ms 的匀速滑动只会和它打架。 */
  scroll-behavior:auto;
  color:var(--nw-fg);
  /* R53c：焦点在这个滚动容器上（翻页靠它收方向键），但它不是「一个控件」——
     给键盘用户看的焦点环在这里只会变成翻页时闪一下的红框。:where() 那条通用
     焦点样式特异性为 0，这里用类选择器就盖住了。 */
  outline:none;
  /* R53b：翻页 = 真的横向滑动。整栏内容向左/向右移过去，下一页从相反方向滑
     进来（位移由 slideToPage() 用 rAF 推 scrollLeft 完成，不是 CSS 过渡）。
     滑动过程中只叠一层很轻的透明度，让字从纸面底色里浮出来；不再整块淡出淡
     入，所以看不到「一个框在动」。 */
  transition:opacity .22s var(--nw-ease, ease);
}
/* 特异度要比 05-css 里那条通用焦点样式更高：它写的是 .nw-root 加 :where()
   （0,2,0），所以这里带两层类再叠伪类。 */
.nw-read-stage .nw-read-flow:focus,
.nw-read-stage .nw-read-flow:focus-visible{outline:none;box-shadow:none;}
.nw-read-gutter{transition:opacity .22s var(--nw-ease, ease);}
/* 滑动时正文轻轻让一下色（字从纸面底色里浮出来，不是整块白底平移），页边签
   先退场——它挂在「某一行」上，滑动中途那行已经不在原位了，跟着跑只会抖。
   透明度只压到 .85：再低字会发灰，读起来像信号不好。 */
.nw-read-stage[data-turn="1"] .nw-read-flow{opacity:.85;}
.nw-read-stage[data-turn="1"] .nw-read-gutter{opacity:0;}
.nw-read-flow::-webkit-scrollbar{width:0;height:0;}
.nw-read-flow[data-drag="1"]{cursor:grabbing;}
/* R55: 对开两页时，中间那道装订线。只画在两栏之间——也就是每页正中各一道，
   不会在书页边缘多画出线来（column-rule 只出现在同一页内的栏与栏之间）。
   单页模式下没有这条规则，所以窄屏和以前一模一样。 */
.nw-read-flow[data-spread="1"]{column-rule:1px solid var(--nw-rule);}
.nw-read-chapter{margin:0;}
.nw-read-chapter + .nw-read-chapter{break-before:column;}
.nw-read-title{
  margin:0 0 1.6em;padding-bottom:.7em;
  border-bottom:1px solid var(--nw-rule);
  text-align:center;font-size:1.16em;font-weight:600;
  line-height:1.5;letter-spacing:.04em;color:var(--nw-fg);
  break-after:avoid;
}
/* R69: 两端对齐。阅读页的段落按 Justification 排，但最后一行必须留在左边
   （text-align-last:left）——否则每段结尾那几个字会被拉满一整行，中文里看起来
   像是排版坏了。text-indent:2em 的首行缩进不受影响。 */
.nw-read-p{
  margin:0 0 .9em;text-indent:2em;
  white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;
  text-align:justify;text-align-last:left;
}
/* An empty line in the manuscript is a scene break, not a typo: it earns an
   extra line of air instead of being flattened into the paragraph wall. */
.nw-read-p[data-gap="1"]{margin-top:1.1em;}
.nw-read-p:last-child{margin-bottom:0;}
/* ---- 标注（读视图）------------------------------------------------------
   Marks are drawn under the words, never over them: an underline sits below the
   glyphs, a strike-through is a line through the middle of the em box, and a
   comment is a wash of colour plus a rule. The manuscript text itself is
   untouched, so annotating can never change the words or the pagination. */
.nw-mark{border-radius:var(--nw-r-hair);}
.nw-mark-underline{box-shadow:inset 0 -2px 0 var(--nw-mark-underline, var(--nw-brand));}
/* R49: 1.5px 在大字号下细得像根头发，读者以为是渲染毛刺而不是自己划的线。
   给一个随字号走的厚度：小字两像素，大字更粗。先写固定值兜底，再写 max()。 */
.nw-mark-strike{
  text-decoration:line-through;
  text-decoration-color:var(--nw-mark-strike, var(--nw-danger));
  text-decoration-thickness:2px;
  text-decoration-thickness:max(2px, .09em);
}
.nw-mark-comment{
  background-color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 16%, transparent);
  box-shadow:inset 0 -1px 0 var(--nw-mark-comment, var(--nw-brand));
}
.nw-mark[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 30%, transparent);
  box-shadow:inset 0 -1px 0 var(--nw-brand);
}
/* R53d：删除线被点开时只加底色，不补底边——它身上已经有一条穿字而过的线，再加
   一道底边就成了「删除线附带下划线」，和编辑页那个 bug 是同一个。 */
.nw-mark-strike[data-active="1"]{box-shadow:none;}
/* 选中的标注：用外描边而不是换色，正文颜色始终是作者的字色。 */
.nw-mark[data-selected="1"]{outline:1px solid color-mix(in srgb, var(--nw-brand) 55%, transparent);outline-offset:1px;}
/* 页边批注签（R53）——批注不再在字里插角标。
   用户连着两轮说「小标识遮挡字体」：只要标识和文字共处一行，行距再松也会压到
   某个字，而且字数一多就找不到它指的是哪一句。所以标识搬出正文：落在这一页
   右侧的页边空白里，和它指向的那一行齐平。正文一个像素都不占，也再没有遮挡
   的可能；点这个签就等于点那条线。
   R53 也删掉了 .nw-mark-dot 那一套（零宽锚点 + 字尾小方框）和与之配套的
   splitByMarks 角标节点——没有东西再往正文里塞额外节点了。 */
.nw-read-gutter{
  position:absolute;inset:0;z-index:2;
  pointer-events:none;overflow:hidden;
}
/* R53b：签上带**章内序号**。
   同一行挂两条批注时，两枚签只能上下错开一格——错开之后就分不清哪枚对哪句了，
   光靠「三个点」这种无差别图案更不可能分辨。所以每枚签写自己的序号（按 start
   排序，一章之内唯一），再把鼠标移上去时点亮它对应的那句话：看见序号，也看见
   它指的是哪一行。 */
.nw-mark-side{
  position:absolute;box-sizing:border-box;
  width:16px;height:16px;padding:0;border:0;border-radius:4px;
  display:flex;align-items:center;justify-content:center;
  pointer-events:auto;cursor:pointer;
  font-family:var(--nw-ui-font);font-size:9px;line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:0;
  color:var(--nw-panel);
  background:var(--nw-mark-comment, var(--nw-brand));
  box-shadow:0 0 0 1px color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 30%, transparent);
  transition:transform .12s var(--nw-ease, ease), box-shadow .12s var(--nw-ease, ease);
}
.nw-mark-side:hover{transform:scale(1.12);}
.nw-mark-side[data-active="1"]{box-shadow:0 0 0 2px color-mix(in srgb, var(--nw-brand) 45%, transparent);}
.nw-mark-side:focus-visible{outline:2px solid var(--nw-brand);outline-offset:1px;}
/* 鼠标停在签上、或点开一条批注时，那句话亮起来——这是「分不清是哪个」的答案。
   R53c：原来 14% 太轻，用户说看不出来；现在 26% + 底边一道 2px 品牌线，
   隔着一页也能一眼扫到是哪句。 */
.nw-mark[data-hover="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 26%, transparent);
  box-shadow:inset 0 -2px 0 var(--nw-brand);
}
/* R53d：删除线悬停时也只加底色。底边一旦补上去，删除线底下就多出一道下划线——
   这正是用户报的那个 bug，只不过换了个触发状态。 */
.nw-mark-strike[data-hover="1"]{box-shadow:none;}
.nw-read-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--nw-sp-2);height:100%;
  color:var(--nw-soft);font-family:var(--nw-ui-font);font-size:var(--nw-fs-second);
}
.nw-read-foot{
  flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
  gap:var(--nw-sp-3);
  padding:var(--nw-sp-2) clamp(20px,6vw,64px) clamp(14px,3vh,30px);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-micro);color:var(--nw-soft);
}
.nw-read-hint{transition:opacity .7s var(--nw-ease, ease);}
.nw-read-hint[data-fade="1"]{opacity:0;}
.nw-read-count{font-variant-numeric:tabular-nums;letter-spacing:.06em;}
/* ---- 标注工具条 / 标注详情 ----------------------------------------------
   Both float inside .nw-read-stage, so they travel with the page column
   instead of the window — a toolbar anchored to the viewport would drift away
   from the sentence as soon as the writer turns a page. */
.nw-mark-bar{
  position:fixed;z-index:34;
  display:inline-flex;align-items:center;gap:2px;
  padding:3px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line-strong);
  background:var(--nw-panel);box-shadow:var(--nw-shadow-2);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  transform:translateX(-50%);
}
.nw-mark-bar-btn{
  display:inline-flex;align-items:center;justify-content:center;
  height:28px;padding:0 10px;border:0;border-radius:var(--nw-r-pill);
  background:transparent;color:var(--nw-fg);cursor:pointer;white-space:nowrap;
}
.nw-mark-bar-btn:hover{background:var(--nw-btn-hover);}
/* R50：点开一条标注后浮出来的小窗。位置由组件按点击处算好写进 style，所以这里
   只负责「长什么样」：一小片面板，刚好放得下一句批注——不是屏幕底下那块大白板。 */
.nw-mark-pop{
  position:fixed;left:0;top:0;transform:translateX(-50%);
  z-index:35;width:min(208px,calc(100vw - 16px));
  display:flex;flex-direction:column;gap:4px;
  padding:5px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);background:var(--nw-panel);box-shadow:var(--nw-shadow-3);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  animation:nw-fade-in var(--nw-dur, .18s) var(--nw-ease, ease) both;
}
/* 两个并列的小按钮：删除 / 批注。一行放得下，不用点开第二层。 */
.nw-mark-pop-acts{display:flex;gap:4px;}
.nw-mark-pop-btn{
  flex:1 1 auto;
  height:24px;padding:0 8px;
  border-radius:var(--nw-r-control);border:1px solid var(--nw-line-strong);
  background:var(--nw-btn-bg);color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);white-space:nowrap;
}
.nw-mark-pop-btn:hover{background:var(--nw-btn-hover);}
.nw-mark-pop-btn[data-danger="1"]{color:var(--nw-danger);}
.nw-mark-pop-btn[data-primary="1"]{background:var(--nw-brand);border-color:var(--nw-brand);color:var(--nw-panel);}
/* 两个按钮那一版只是个小条，不该占满正文宽度。 */
.nw-mark-pop.nw-mark-pick{width:auto;padding:4px;}
/* R52：写批注那一版再窄一点、再矮一点——它是一张便条，不是一块面板。
   用户说「编辑框太大」，所以宽度收到 176px、留白也收，让它真的像贴在字边上的便签。
   R53：再收一档（196px 上限）并让它贴着点击处张开；输入框一行高、随字长高，
   最多三行半，绝不先占一块空面板。 */
.nw-mark-pop.nw-mark-edit{width:min(196px,calc(100vw - 16px));padding:5px;gap:3px;}
.nw-mark-pop-note{
  box-sizing:border-box;width:100%;min-height:24px;max-height:64px;
  padding:2px 5px;
  border-radius:var(--nw-r-hair);border:1px solid var(--nw-line);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);line-height:1.45;
  resize:none;overflow-y:auto;
}
.nw-mark-pop-note:focus{outline:none;border-color:var(--nw-brand);}
/* R53e：把一条下划线写成批注时，窗里那一行小字——说明「写下字它就不是下划线了」。
   灰、小、不抢按钮，但必须有：这是唯一会让线本身变样的操作。R53g 之后窗里只剩
   一颗「删除」，这行字反而成了唯一的说明，所以留在批注窗底部、输入框下面。 */
.nw-mark-pop-hint{
  color:var(--nw-soft);font-size:calc(var(--nw-fs-tiny) - 1px);
  line-height:1.35;padding:0 2px;
}
.nw-mark-pop-btn[data-danger="1"]{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 45%, var(--nw-line-strong));}
@media (max-width: 560px){
  .nw-mark-bar-btn{padding:0 8px;}
  .nw-mark-pop{width:min(208px,calc(100vw - 16px));}
}
@media (prefers-reduced-motion: reduce){
  .nw-read{animation:none;}
  .nw-read-flow{scroll-behavior:auto;transition:none;}
  .nw-read-gutter{transition:none;}
  .nw-read-stage[data-turn="1"] .nw-read-flow{opacity:1;}
  .nw-mark-pop{animation:none;}
  .nw-mark-side{transition:none;}
}
@media (max-width: 560px){
  .nw-read-bar{padding-top:var(--nw-sp-2);}
  .nw-read-stage{padding:0 clamp(16px,5vw,28px);}
  .nw-read-foot{padding-left:clamp(16px,5vw,28px);padding-right:clamp(16px,5vw,28px);}
}
`);

  /**
   * 阅读视图。
   *
   * props:
   *   novel       — 当前这本书（只用来显示书名，可为 null）
   *   chapters    — 这本书的所有章节（已按文档顺序、含 content）
   *   currentId   — 打开时想停在哪一章
   *   currentText — 当前章节编辑器里的**实时**文本（含尚未保存的字）
   *   settings    — 用来沿用字号/行高/主题
   *   marks       — 整本书的标注（`{id, chapterId, kind, start, end, note}`）
   *   onMark      — `(draft) => void`，把新标注交给上层去存
   *   onUnmark    — `(id) => void`，删掉一条标注
   *   onNote      — `(id, note) => void`，改批注正文
   *   onClose     — 退出
   */
  NW.ReadView = function ReadView(props) {
    const p = props || {};
    const settings = p.settings || {};

    const fontSize = clampNum(numOf(settings.fontSize, 20), 11, 42);
    const lineHeight = clampNum(numOf(settings.lineHeight, 2), 1.1, 3.4);
    const themeKey = THEME_KEYS[String(settings.theme || '')] ? String(settings.theme) : 'claude';
    const novelTitle = p.novel && p.novel.title ? String(p.novel.title) : '';
    const currentId = p.currentId == null ? null : String(p.currentId);
    const currentText = typeof p.currentText === 'string' ? p.currentText : null;
    const chapters = (Array.isArray(p.chapters) ? p.chapters : []).filter(Boolean);
    const marks = (Array.isArray(p.marks) ? p.marks : []).filter(Boolean);

    const stageRef = React.useRef(null);
    const flowRef = React.useRef(null);
    const gutterRef = React.useRef(null);
    const paintGutterRef = React.useRef(null);
    // 当前打开的那条标注：页边签是命令式重画的，重画后要把「选中」那枚重新点亮。
    const activeRef = React.useRef('');
    const noteRef = React.useRef(null);
    const composerRef = React.useRef(null);
    const turnTimersRef = React.useRef([]);
    // 正在跑的滑动动画（一次一帧，翻页/卸载时取消）。
    const slideRef = React.useRef(0);
    // 滑动开始时容器的 scroll-behavior 原值：中途被打断要还回去。
    const slideWasRef = React.useRef('');
    const marksRef = React.useRef({});
    const jumpedRef = React.useRef(false);
    const pageRef = React.useRef(0);
    const scrollRafRef = React.useRef(0);
    const pointerRef = React.useRef(null);
    // 程序自己滚动时（翻页 / 重排后回位）暂停「滚动 → 页码」的同步：平滑滚动
    // 中途会经过中间位置，不听会让页码在跳页时闪一下。
    const quietRef = React.useRef(0);
    const wheelRef = React.useRef({ acc: 0, at: 0 });

    // w = 栏宽（= 行宽），gap = 栏间距，total = 总页数。三者都来自真实布局测量。
    const [layout, setLayout] = React.useState({ w: 0, gap: 0, total: 1 });
    const [page, setPage] = React.useState(0);
    const [hintOn, setHintOn] = React.useState(true);

    const maxPage = Math.max(0, layout.total - 1);
    // R55：一页有多宽（单页 = 一栏 + 栏距，对开 = 两栏 + 两个栏距里的一整段）。
    // 由 measure() 算好后放进 layout，凡是「翻一页」都读它，别再各自拼 w+gap。
    const step = layout.step || (layout.w + layout.gap);

    const close = React.useCallback(() => {
      if (typeof p.onClose === 'function') p.onClose();
    }, [p.onClose]);

    // Esc 走弹层自己的栈（40-ui 的 useEscapeOwner）：一次 Esc 只关一层，
    // 也不会被沉浸模式的 Esc 抢先退出全屏。
    // R50：批注小窗开着时，Esc 先收小窗，再按一次才离开「读一遍」。
    // R53：新批注的便签也算一层。
    NW.useModalEscape(true, () => {
      if (composer) {
        closeComposer();
        return;
      }
      if (editing || picked) {
        closeMark();
        return;
      }
      close();
    });

    // 焦点必须离开 textarea，否则翻页的方向键会直接打进正文里。焦点落在
    // 分页容器上（tabIndex=-1），滚动容器自己也能收到方向键。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (flow && typeof flow.focus === 'function') {
        try {
          flow.focus({ preventScroll: true });
        } catch (err) {
          flow.focus();
        }
      }
    }, []);

    const clearTurns = () => {
      const list = turnTimersRef.current;
      for (let i = 0; i < list.length; i += 1) window.clearTimeout(list[i]);
      turnTimersRef.current = [];
      if (slideRef.current) {
        window.cancelAnimationFrame(slideRef.current);
        slideRef.current = 0;
        // 半路叫停的滑动必须把自己临时改过的 scroll-behavior 还回去，否则这
        // 本书后面所有的「瞬间跳页」都会变成 300ms 的匀速滑动。
        const flow = flowRef.current;
        if (flow) flow.style.scrollBehavior = slideWasRef.current;
      }
    };

    // 瞬间落到某一页：把 CSS 的平滑滚动临时关掉，否则「瞬间」也会被浏览器补
    // 成一段 300ms 的滑动。要滑动的翻页走 slideToPage()，这里只负责「立刻」。
    const scrollToPage = React.useCallback((index) => {
      const flow = flowRef.current;
      if (!flow) return;
      const s = step;
      if (!s) return;
      const left = Math.round(index * s);
      // 让滚动监听器在这段时间里安静：中途每一帧的 scrollLeft 都落在两页之间，
      // 不屏蔽会把页码拖来拖去。
      quietRef.current = Date.now() + 200;
      const was = flow.style.scrollBehavior;
      flow.style.scrollBehavior = 'auto';
      flow.scrollLeft = left;
      flow.style.scrollBehavior = was;
    }, [step]);

    // R53b：把「翻页」做成一次真正的横向滑动。滚的是容器的 scrollLeft，所以
    // 效果就是整页内容往一侧走、下一页从另一侧进来——和纸质书翻页时视线移动
    // 的方向一致。用 rAF 自己推，是为了控制时长和缓动（CSS 的 smooth 是 300ms
    // 匀速，收尾很硬），也让「滑到一半又按了下一翻」能立刻改向。
    const slideToPage = React.useCallback((index) => {
      const flow = flowRef.current;
      const stage = stageRef.current;
      if (!flow || !stage) {
        if (stage) stage.removeAttribute('data-turn');
        return;
      }
      const s = step;
      if (!s) {
        stage.removeAttribute('data-turn');
        return;
      }
      const from = flow.scrollLeft;
      const to = Math.round(index * s);
      const dist = Math.abs(to - from);
      if (dist < 2) {
        scrollToPage(index);
        if (stage) stage.removeAttribute('data-turn');
        return;
      }
      // 滑动期间屏蔽 scroll 监听器：每一帧 scrollLeft 都在两页之间，不屏蔽会
      // 把页码拖来拖去，还会触发「对齐到整页」的吸附，跟动画打架。
      const was = flow.style.scrollBehavior;
      flow.style.scrollBehavior = 'auto';
      slideWasRef.current = was;
      // R53c：用户说「翻页太快，没有动画」。原来 190-320ms 的起步快收尾慢，眨眼
      // 就过去了；现在整页翻是 560ms，缓动换成「两头都慢、中间快」的 easeInOut：
      // 起手轻轻带起来，中段走过去，最后自己停住——像纸页被手指推过去，而不是
      // 被谁一甩。
      // 但吸附（手指松开后那一点点回正）走的是同一个函数，不能也等半秒：时长按
      // 「这次要走多远 / 一页有多宽」缩放，走满一页 560ms，走几像素 ~190ms。
      const ratio = Math.min(1, dist / Math.max(1, s));
      const dur = Math.round(190 + ratio * 370);
      quietRef.current = Date.now() + dur + 140;
      const t0 = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      // 这个回调不能叫 step：外层的 step 是「一页有多宽」，同心圆里再声明一个
      // 同名 const 会把上面那行 `const s = step` 推进 TDZ（读的是还没初始化的
      // 那个），运行时报 ReferenceError。
      const frame = (now) => {
        const t = Math.min(1, Math.max(0, (now - t0) / dur));
        flow.scrollLeft = from + (to - from) * ease(t);
        if (t < 1) {
          slideRef.current = window.requestAnimationFrame(frame);
          return;
        }
        flow.scrollLeft = to;
        flow.style.scrollBehavior = was;
        slideRef.current = 0;
        quietRef.current = Date.now() + 160;
        if (stage) stage.removeAttribute('data-turn');
      };
      slideRef.current = window.requestAnimationFrame(frame);
    }, [step, scrollToPage]);

    const go = React.useCallback((delta) => {
      // pageRef is the source of truth: the scroll listener writes it on every
      // swipe, so reading it here keeps clicks and keys in sync with the finger.
      const cur = pageRef.current;
      const next = Math.max(0, Math.min(maxPage, cur + delta));
      if (next === cur) return;
      pageRef.current = next;
      setPage(next);
      const stage = stageRef.current;
      if (!stage) return;
      const still = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) {
        // No motion wanted: swap the page with no slide at all.
        scrollToPage(next);
        return;
      }
      // R53b：翻页是**真的横向滑动**——整栏往翻页方向走，下一页从相反方向滑
      // 进来。位移由 rAF 推 scrollLeft 完成（不是 CSS transition，因为要滚的是
      // 滚动容器的 scrollLeft 而不是 transform），翻页方向就是滑动方向：往后翻
      // 内容向左走，往前翻内容向右走。
      // 滑动期间只把整体压到 .72 的透明度再回来：字从纸面底色里浮出来，不会
      // 像「隔着一个框」那样整块平移一块白底。
      clearTurns();
      stage.setAttribute('data-turn', '1');
      slideToPage(next);
    }, [maxPage, scrollToPage, slideToPage]);

    React.useEffect(() => () => clearTurns(), []);

    // ---- 选字 → 标注 --------------------------------------------------------
    //
    // 每一段都带着自己在章节全文里的起点（`data-start`），所以一次选区可以翻
    // 译成「哪一章、第几个字到第几个字」——标注就是用这组下标存的，跟界面上
    // 怎么分段、怎么分页都无关。
    const [sel, setSel] = React.useState(null);
    // R50: 点一条标注之后先浮出一个两个按钮的小菜单（删除 / 批注）；批注正文则在
    // 一个贴着点击处的小编辑框里改，不再占用屏幕底下那块大白板。
    const [picked, setPicked] = React.useState(null);
    const [editing, setEditing] = React.useState(null);
    const [noteDraft, setNoteDraft] = React.useState('');
    // R53：新写一条批注不再弹 `NW.ui.prompt` 那块大对话框——就在选中的字旁边
    // 展开一张便签，写完按保存才落库，按取消就当没发生过。
    const [composer, setComposer] = React.useState(null);
    const [composerNote, setComposerNote] = React.useState('');

    // ---- 自动保存（R53g）----------------------------------------------------
    // 批注框不再有「保存 / 取消」。字打进去就存，停下来 700ms 落一次库；关掉框
    // （点别处、Esc、滚动、翻页）时立刻把还没落的那一次补上。
    //
    // 为什么不是每个按键都存：`onNote` 背后是 db.updateMark → notify → 应用层
    // refreshMarks → marks 换新 → 本组件的 body 重新把整本书拆一遍段落。一本
    // 二十万字的稿子两万行，每按一个字拆一次会当场卡住。合并成一次写，既保住
    // 「不用点保存」，也不让打字变成重活。
    const noteSaveRef = React.useRef({ id: '', timer: 0, body: '', saved: '', dirty: false });
    const composerSaveRef = React.useRef({ id: '', timer: 0, body: '', saved: '', draft: null });
    // 这一下 pointerdown 是不是「把浮层点掉」的。pointerup 里据此跳过翻页。
    // 存时间戳而不是布尔：点在正文外时 flow 收不到 pointerup，布尔会一直挂着，
    // 把下一次正常的翻页吞掉。
    const dismissedRef = React.useRef(0);

    const flushNote = React.useCallback(() => {
      const st = noteSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      if (!st.dirty || !st.id) return;
      st.dirty = false;
      const body = String(st.body || '').trim();
      if (body === st.saved) return;
      st.saved = body;
      if (typeof p.onNote === 'function') p.onNote(st.id, body);
    }, [p.onNote]);

    const scheduleNote = React.useCallback((id, body) => {
      const st = noteSaveRef.current;
      st.id = String(id);
      st.body = body;
      st.dirty = true;
      if (st.timer) window.clearTimeout(st.timer);
      st.timer = window.setTimeout(() => {
        st.timer = 0;
        flushNote();
      }, 700);
    }, [flushNote]);

    // 删掉一条批注前先把待写的这一次作废：先存再删是白跑一趟，而且万一删除先
    // 落库、保存后落库，还会留下一条「刚删掉又冒出来」的行。
    const dropNote = React.useCallback(() => {
      const st = noteSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      st.dirty = false;
    }, []);

    // 新写的那条批注：第一次出现非空文字时才真正建行（否则「写批注」点开又
    // 什么都不写，会留下一条有批注底色却没有签的空批注——三种状态里最说不清的
    // 一种）。建好之后就是普通的改批注。
    const commitComposer = React.useCallback(() => {
      const st = composerSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      const body = String(st.body || '').trim();
      if (st.id) {
        if (body === st.saved) return;
        st.saved = body;
        if (typeof p.onNote === 'function') p.onNote(st.id, body);
        return;
      }
      if (!body || !st.draft) return;
      // 第一次落库是异步的（`p.onMark` 走 db 再回来才有 id）。这期间用户还在打字，
      // 700ms 的下一拍会再进来一次——那时 `st.id` 还是空的，会再建一条。db 层按
      // 「同章 + 同起止」会合并，但这里也没必要让它白跑一趟，用一个 pending 挡住。
      if (st.pending) {
        st.saved = body;
        return;
      }
      st.saved = body;
      st.pending = true;
      const draft = st.draft;
      if (typeof p.onMark === 'function') {
        Promise.resolve(p.onMark({
          chapterId: draft.chapterId,
          kind: 'comment',
          start: draft.start,
          end: draft.end,
          quote: draft.quote,
          note: body,
        })).then((created) => {
          st.pending = false;
          if (created && created.id != null) st.id = String(created.id);
        }).catch(() => { st.pending = false; });
      } else {
        st.pending = false;
      }
    }, [p.onMark, p.onNote]);

    const scheduleComposer = React.useCallback((body) => {
      const st = composerSaveRef.current;
      st.body = body;
      if (st.timer) window.clearTimeout(st.timer);
      st.timer = window.setTimeout(() => {
        st.timer = 0;
        commitComposer();
      }, 700);
    }, [commitComposer]);

    // 关掉整个「读一遍」时别把最后一句丢了。
    React.useEffect(() => () => {
      flushNote();
      commitComposer();
    }, [flushNote, commitComposer]);

    // ---- 点别处收起（R53g）--------------------------------------------------
    // 用户要的是「鼠标点击其他任何地方，批注输入框收起来」。只在 flow 里监听不够：
    // 顶栏、页脚、页边签、甚至窗口外框都算「其他地方」。所以在 document 上做捕获，
    // 命中就收——但落在 `.nw-mark-pop`（也就是输入框自己）和正在编辑的那条标注
    // 上时不收，否则点一下输入框里的字就把它关了。
    //
    // 用 pointerdown 而不是 click：点击的顺序是 pointerdown → blur → click，若等到
    // click，textarea 的 blur 已经先触发过一次保存，框也会在按下与松开之间闪一下。
    // 捕获阶段先处理，一次点击只收一次。
    React.useEffect(() => {
      const onDown = (ev) => {
        const node = ev && ev.target;
        if (!node || typeof node.closest !== 'function') return;
        // 点在输入框里（含删除按钮）：不关。
        if (node.closest('.nw-mark-pop')) return;
        // 点在「正在编辑的那条批注」上：也不关，那是它的锚点。
        if (node.closest('.nw-mark[data-mark]')) return;
        if (node.closest('.nw-mark-side')) return;
        if (composerRef.current && composerRef.current.contains && composerRef.current.contains(node)) return;
        if (noteRef.current && noteRef.current.contains && noteRef.current.contains(node)) return;
        // 这一下如果是「把框点掉」，就不要再当成翻页：一次 pointerdown 既收框又
        // 翻页，等于点一下同时做了两件事，用户只会觉得「手一抖书就翻了」。
        if (picked || editing || composer) dismissedRef.current = Date.now();
        // 收起之前先把字存掉——收起 = 保存。
        if (noteSaveRef.current.dirty || noteSaveRef.current.timer) flushNote();
        if (composerSaveRef.current.timer || composerSaveRef.current.body) {
          commitComposer();
          composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
        }
        setPicked(null);
        setEditing(null);
        setComposer(null);
        setComposerNote('');
        activeRef.current = '';
        const flow = flowRef.current;
        if (flow) {
          const spans = flow.querySelectorAll('.nw-mark[data-mark][data-active]');
          for (let i = 0; i < spans.length; i += 1) spans[i].removeAttribute('data-active');
        }
        const layer = gutterRef.current;
        if (layer) {
          const signs = layer.querySelectorAll('.nw-mark-side[data-active]');
          for (let i = 0; i < signs.length; i += 1) signs[i].removeAttribute('data-active');
        }
      };
      document.addEventListener('pointerdown', onDown, true);
      return () => document.removeEventListener('pointerdown', onDown, true);
    }, [flushNote, commitComposer, picked, editing, composer]);

    function locateNode(node) {
      let el = node;
      if (el && el.nodeType === 3) el = el.parentNode;
      if (!el || typeof el.closest !== 'function') return null;
      const para = el.closest('p[data-start]');
      if (!para) return null;
      const section = para.closest('[data-chapter-id]');
      if (!section) return null;
      return {
        para: para,
        chapterId: String(section.getAttribute('data-chapter-id') || ''),
        base: Number(para.getAttribute('data-start')) || 0,
      };
    }

    function offsetIn(node, offset) {
      const hit = locateNode(node);
      if (!hit) return null;
      try {
        const r = document.createRange();
        r.setStart(hit.para, 0);
        r.setEnd(node, offset);
        return {
          chapterId: hit.chapterId,
          at: hit.base + String(r.toString() || '').length,
        };
      } catch (err) {
        return null;
      }
    }

    // Selection 变化时算出「原文区间」。跨章、跨段的选区都支持：两端各翻译一次。
    const readSelection = React.useCallback(() => {
      const sel0 = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (!sel0 || !sel0.rangeCount) return null;
      const text = String(sel0.toString() || '');
      if (!text.trim()) return null;
      const range = sel0.getRangeAt(0);
      const a = offsetIn(range.startContainer, range.startOffset);
      const b = offsetIn(range.endContainer, range.endOffset);
      if (!a || !b) return null;
      if (a.chapterId !== b.chapterId) return null;
      const start = Math.min(a.at, b.at);
      const end = Math.max(a.at, b.at);
      if (end <= start) return null;
      let rect = null;
      try {
        rect = range.getBoundingClientRect();
      } catch (err) {
        rect = null;
      }
      return {
        chapterId: a.chapterId,
        start: start,
        end: end,
        text: text.replace(/\s+\n/g, '\n'),
        x: rect ? rect.left + rect.width / 2 : 0,
        y: rect ? rect.top : 0,
      };
    }, []);

    const addMark = React.useCallback((kind) => {
      const cur = sel;
      if (!cur) return;
      // 同一条线重复画：db 层会把「同章 + 同起止」并成一条，所以这里照常提交，
      // 画第二遍只会把这条线换成新类型，不会多出一条删不掉的影子。
      if (typeof p.onMark === 'function') {
        p.onMark({
          chapterId: cur.chapterId,
          kind: kind,
          start: cur.start,
          end: cur.end,
          quote: cur.text.slice(0, 240),
          note: '',
        });
      }
      clearSelection();
    }, [sel, p.onMark]);

    const clearSelection = () => {
      setSel(null);
      const s = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s) s.removeAllRanges();
    };

    // R53：原来这里调 `NW.ui.prompt`，弹的是屏幕正中一块大白板，跟选中的字
    // 完全脱开；用户说「输入框太大」。现在只记下选区，让渲染层在选区旁边画
    // 一张一行高的便签。R53g：便签上没有保存键——字打进去就存（停 700ms 落库，
    // 收起来时补最后一次）。
    const openComposer = React.useCallback(() => {
      const cur = sel;
      if (!cur) return;
      setPicked(null);
      setEditing(null);
      setComposerNote('');
      const st = composerSaveRef.current;
      if (st.timer) window.clearTimeout(st.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer({
        chapterId: cur.chapterId,
        start: cur.start,
        end: cur.end,
        quote: cur.text.slice(0, 240),
        x: cur.x,
        y: cur.y + 18,
      });
    }, [sel]);

    const closeComposer = React.useCallback(() => {
      // 收起来之前把没落库的那一次补上——「点别处收起」不等于「放弃」。
      commitComposer();
      const st = composerSaveRef.current;
      if (st.timer) window.clearTimeout(st.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer(null);
      setComposerNote('');
      clearSelection();
    }, [commitComposer]);

    // 讲清楚「点一下标注会发生什么」：就在点的位置浮出两个小按钮——删除 / 批注。
    // 点亮那几个 `<span>` 用 DOM 直接改属性，不把 picked 塞进正文的 useMemo
    // 依赖——否则每点一次标注就要把全书重新拆一遍段（正是 R44 修掉的卡顿）。
    const openMark = React.useCallback((id, ev) => {
      const list = marks.filter((m) => String(m.id) === String(id));
      const mark = list[0];
      if (!mark) return;
      // R53：弹层贴着**点击处**张开。R50 时是贴着「离点击最近的那一行字」的
      // 右下角，点在句子中间时框会飘到行尾十几厘米外，用户还得回手去够它。
      // 现在只在拿不到点击坐标时（键盘/程序触发）才退回行盒定位。
      const flow = flowRef.current;
      let clickX = ev && typeof ev.clientX === 'number' ? ev.clientX : NaN;
      let clickY = ev && typeof ev.clientY === 'number' ? ev.clientY : NaN;
      let best = null;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark="' + String(id) + '"]');
        let bestDist = Infinity;
        for (let i = 0; i < spans.length; i += 1) {
          const rects = spans[i].getClientRects ? spans[i].getClientRects() : [];
          for (let k = 0; k < rects.length; k += 1) {
            const r = rects[k];
            if (!r || (!r.width && !r.height)) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dist = Math.abs(cx - (Number.isFinite(clickX) ? clickX : cx))
              + Math.abs(cy - (Number.isFinite(clickY) ? clickY : cy));
            if (dist < bestDist) { bestDist = dist; best = r; }
          }
        }
        for (let i = 0; i < spans.length; i += 1) {
          spans[i].setAttribute('data-active', spans[i].getAttribute('data-mark') === String(id) ? '1' : '0');
        }
      }
      activeRef.current = String(id);
      const layer = gutterRef.current;
      if (layer) {
        const signs = layer.querySelectorAll('.nw-mark-side');
        for (let i = 0; i < signs.length; i += 1) {
          if (signs[i].getAttribute('data-mark') === String(id)) signs[i].setAttribute('data-active', '1');
          else signs[i].removeAttribute('data-active');
        }
      }
      if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) {
        if (!best) return;
        clickX = best.left + Math.min(best.width, 120) * 0.4;
        clickY = best.top + best.height / 2;
      }
      // 打开一张新面板就把便签收起来，同时只留一个浮层。R53g：收之前先把便签里
      // 还没落库的字存掉——「换看另一条」不是「把刚写的扔掉」。
      commitComposer();
      const cst = composerSaveRef.current;
      if (cst.timer) window.clearTimeout(cst.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer(null);
      setComposerNote('');
      // R53e：文字只属于批注，所以「是不是批注」直接看有没有文字——一条带字的
      // 线就是批注，点它就开编辑框。下划线和删除线（没有字）则先问「删了它，还是
      // 给它写一句」，因为这两件事对一条线都说得通，而线本身并不暗示哪一个。
      if (String(mark.kind) === 'comment' || String(mark.note || '').trim()) {
        setPicked(null);
        // 换到另一条批注之前，把上一条还没落库的字补上。
        flushNote();
        const st = noteSaveRef.current;
        st.id = String(mark.id);
        st.body = String(mark.note || '');
        st.saved = String(mark.note || '').trim();
        st.dirty = false;
        setNoteDraft(String(mark.note || ''));
        setEditing({ mark: mark, x: clickX, y: clickY });
        return;
      }
      flushNote();
      setEditing(null);
      setPicked({ mark: mark, x: clickX, y: clickY });
    }, [marks, commitComposer, flushNote]);

    const closeMark = React.useCallback(() => {
      // R53g：收起批注框 = 保存，不是放弃。没有保存键，那一下必须在这里补。
      flushNote();
      setPicked(null);
      setEditing(null);
      activeRef.current = '';
      const flow = flowRef.current;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark]');
        for (let i = 0; i < spans.length; i += 1) spans[i].setAttribute('data-active', '0');
      }
      const layer = gutterRef.current;
      if (layer) {
        const signs = layer.querySelectorAll('.nw-mark-side[data-active]');
        for (let i = 0; i < signs.length; i += 1) signs[i].removeAttribute('data-active');
      }
    }, [flushNote]);

    // ---- 页边批注签（R53）---------------------------------------------------
    // 一条带批注的标注，在这一页的右侧页边留一个小签，和它指向的那一行齐平。
    // 只在当前页上画：翻过去之后下一页的签会由 scroll/重排重新算出来。
    // 正文里不再有任何角标节点，所以「遮挡字体」从结构上就不可能再发生。
    const paintGutter = React.useCallback(() => {
      const layer = gutterRef.current;
      const stage = stageRef.current;
      const flow = flowRef.current;
      if (!layer) return;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      // 重画时把上一轮的悬停点亮清掉：签是新建的，正文上的 data-hover 却留在旧
      // 节点上——不扫一遍的话，改完字之后会有一句话一直亮着，像被选中了一样。
      const stale = flow ? flow.querySelectorAll('.nw-mark[data-hover]') : [];
      for (let i = 0; i < stale.length; i += 1) stale[i].removeAttribute('data-hover');
      if (!stage || !flow) return;
      const w = layout.w;
      if (!w) return;
      const cols = layout.cols || 1;
      const gap = layout.gap || 0;
      // R55：一页现在可能是两栏。判定「这句在不在这页上」要用**页宽**（两栏加
      // 中间的空档），不是一栏的宽——否则右半页的批注全都不出签。
      const pageW = w * cols + gap * (cols - 1);
      const stageRect = stage.getBoundingClientRect();
      const flowRect = flow.getBoundingClientRect();
      // R56：对开时签要分左右。
      // 用户说「批注左页的在左侧，右页在右侧，变回单页时再回到右侧」——对开是
      // 摊开的书，视线落在哪一页，那页的话就在哪一页的**外缘**；两页的签都挤在
      // 书缝右边的话，左页的签会在右页的正文旁边，指认起来是错的。
      // 所以 x 不再是常量：左栏的签落在整本书的左外侧，右栏的签落在右外侧，
      // 单页（cols === 1）时所有签都回到右侧，和 R53 一样。
      const PAD = 3;
      const SIDE_W = 16;
      // 左缘可能不够宽（stage 的左右 padding 是 clamp(20px,6vw,64px)，最窄 20px
      // 而那正好是签要占的 16+3=19px）。gutter 是 overflow:hidden，所以夹一下，
      // 不够就退回书内侧，宁可挤一点也不能让签整枚消失。
      const leftOuter = Math.max(
        0,
        Math.round(flowRect.left - stageRect.left - SIDE_W - PAD),
      );
      const rightOuter = Math.round(flowRect.right - stageRect.left + PAD);
      const notes = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        if (!m || m.id == null) continue;
        const body = String(m.note || '').trim();
        // R53e：签只属于**有字**的批注。以前这里放行 `kind==='comment'` 的空批注，
        // 结果会有一枚签指着一句没有任何话的话；现在批注必须有文字，没字就没有签。
        if (!body) continue;
        notes[String(m.id)] = body;
      }
      // 序号：同一章里所有带批注的标注按 start 排，1、2、3……章内唯一。
      // 读者看到的是「第 3 条批注」，而不是一枚和隔壁一模一样的点。
      const seq = {};
      const byChapter = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        if (!m || m.id == null) continue;
        if (!Object.prototype.hasOwnProperty.call(notes, String(m.id))) continue;
        const ck = String(m.chapterId || '');
        if (!byChapter[ck]) byChapter[ck] = [];
        byChapter[ck].push(m);
      }
      const chapterKeys = Object.keys(byChapter);
      for (let i = 0; i < chapterKeys.length; i += 1) {
        const list = byChapter[chapterKeys[i]].slice().sort(
          (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0),
        );
        for (let k = 0; k < list.length; k += 1) seq[String(list[k].id)] = k + 1;
      }
      const spans = flow.querySelectorAll('.nw-mark[data-mark]');
      const tops = {};
      for (let i = 0; i < spans.length; i += 1) {
        const id = spans[i].getAttribute('data-mark') || '';
        if (!Object.prototype.hasOwnProperty.call(notes, id)) continue;
        if (tops[id] != null) continue;
        const rects = spans[i].getClientRects ? spans[i].getClientRects() : [];
        for (let k = 0; k < rects.length; k += 1) {
          const r = rects[k];
          if (!r || (!r.width && !r.height)) continue;
          // 只给当前页上的片段配签：下一页的等翻过去再说。对开时一页横跨两栏，
          // 所以这里用 pageW。
          if (r.left < flowRect.left - 1 || r.left > flowRect.left + pageW - 2) continue;
          // R56：这句落在哪一栏？左栏的签去左边，右栏的签去右边。用片段的中心点
          // 判，而不是左边缘——一个长句可能跨过栏界（虽然多栏布局通常不会让一行
          // 跨栏，但取中心的容错更好）。
          const cx = r.left + r.width / 2;
          // column 0 = 本页左栏。一栏宽 w、栏距 gap，所以第 n 栏的左边界是
          // flowRect.left + n * (w + gap)。
          const colAt = Math.max(0, Math.min(cols - 1, Math.floor((cx - flowRect.left) / (w + gap))));
          const onLeft = cols > 1 && colAt === 0;
          tops[id] = {
            y: r.top + Math.min(r.height, 30) / 2 - stageRect.top,
            onLeft: onLeft,
          };
          break;
        }
      }
      const rows = Object.keys(tops)
        .map((id) => ({ id: id, y: tops[id].y, onLeft: tops[id].onLeft, note: notes[id] }))
        .sort((a, b) => a.y - b.y);
      const used = [];
      const usedL = [];
      const SIDE_H = 16;
      // 同一行挂了多条批注时，签会往下错开一格，免得两枚叠成一个。错开之后
      // 靠什么分辨？R53c 的答案不再是引线（用户说那条细线看不出来），而是
      // **句子自己变色**：鼠标停在签上、或点开一条批注时，它指的那句亮起来，
      // 签上的序号说「第几条」。一冷一热两个信号，比在页边画线清楚得多。
      // R56：左右两边的签各自排自己的队——它们在书的两侧，本就不会相撞，
      // 混在一个 used 里会让右边的签因为左边的位置而无谓地下移。
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const lane = row.onLeft ? usedL : used;
        let y = row.y - SIDE_H / 2;
        // 同一行挂了两条批注：第二个签往下让一格，别叠成一个。
        while (lane.some((u) => Math.abs(u - y) < SIDE_H + 2)) y += SIDE_H + 2;
        lane.push(y);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nw-mark-side';
        btn.setAttribute('data-mark', row.id);
        if (row.onLeft) btn.setAttribute('data-side', 'left');
        btn.setAttribute('aria-label', NW.t('第') + (seq[row.id] || '') + NW.t('条批注'));
        btn.title = (seq[row.id] ? '#' + seq[row.id] + ' ' : '') + (row.note || NW.t('批注')).slice(0, 80);
        btn.textContent = String(seq[row.id] || '');
        if (activeRef.current && activeRef.current === String(row.id)) btn.setAttribute('data-active', '1');
        // R53c：不再画引线（用户说看不出来）。同一行第二条批注靠「悬停/点开时
        // 句子变色」来指认——签上的序号说第几条，句子亮起来说哪一行。
        // R56：左页的签贴左外缘，右页的签贴右外缘；单页时 onLeft 恒为 false，
        // 于是所有签都在右侧，与之前完全一致。
        btn.style.left = (row.onLeft ? leftOuter : rightOuter) + 'px';
        btn.style.top = Math.round(y) + 'px';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openMark(row.id, ev);
        });
        // 悬停：把签指的那句点亮。同一行有两条批注时，靠这个一眼分清谁是谁。
        btn.addEventListener('mouseenter', () => {
          const own = flow.querySelectorAll('.nw-mark[data-mark="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].setAttribute('data-hover', '1');
        });
        btn.addEventListener('mouseleave', () => {
          const own = flow.querySelectorAll('.nw-mark[data-mark="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].removeAttribute('data-hover');
        });
        layer.appendChild(btn);
      }
    }, [layout.w, layout.cols, layout.gap, marks, openMark]);

    // 滚动停下来之后重算一次：手指拖到半页时，签要跟着字走，不能停在旧行上。

    // ---- 量一次版面：定栏宽 → 读 scrollWidth → 得到页数 ----------------------
    //
    // R55: 分两页。用户的要求是「阅读页面如果是全屏模式下，请分两页」。
    //
    // 这里刻意**没有**去读某个「沉浸模式」标志：读一遍本身就是全屏的（它是
    // `.nw-read` 绝对定位铺满的浮层），没有一个单独的 immersive 开关可读；真正
    // 决定能不能并排放下两栏的，是**可用的宽度**。所以判据是宽度：一栏最多
    // 34 个汉字，两栏加中间的空档放得下就开对开，放不下就还是单页。窄面板（手机、
    // 侧栏挤出来的半屏）自动退回单页，不需要另一套逻辑。
    //
    // 三处步长都必须跟着页宽走，否则翻页会翻半页：
    //   - measure() 里的 total 和起始页偏移
    //   - scrollToPage() / slideToPage() 里的 s
    //   - 滚动监听里换算页码的 s
    // 三者统一读 layout.step（= 一页有多宽，含中间的空档）。
    const measure = React.useCallback(() => {
      const stage = stageRef.current;
      const flow = flowRef.current;
      if (!stage || !flow) return;
      const cs = window.getComputedStyle(stage);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = Math.max(240, stage.clientWidth - padX);
      const gap = parseFloat(window.getComputedStyle(flow).columnGap) || 0;
      // 一行 34 个汉字上下最像书。
      const oneCol = Math.floor(Math.min(34 * fontSize, avail));
      // 对开要求：两栏 + 中间那道空档真的放得下，而且每栏还不至于窄到一行
      // 十来个字（那比单页更难读）。900px 是临界点，再窄就单页。
      const spread = avail >= 900 && (avail - gap) / 2 >= 300;
      const cols = spread ? 2 : 1;
      const w = spread
        ? Math.floor(Math.min(oneCol, (avail - gap) / 2))
        : oneCol;
      flow.style.setProperty('--nw-read-col', w + 'px');
      flow.style.setProperty('--nw-read-box', (w * cols + gap * (cols - 1)) + 'px');
      if (spread) flow.setAttribute('data-spread', '1');
      else flow.removeAttribute('data-spread');
      // 一栏的步长（栏宽 + 栏距）：栏在 CSS 多栏里是连续的，页只是「一次显示几栏」。
      const colStep = w + gap;
      // 一页的步长：对开时跨两栏。
      const step = colStep * cols;
      const total = Math.max(1, Math.round((flow.scrollWidth + gap) / step));
      setLayout({ w, gap, total, cols, step });

      if (!jumpedRef.current) {
        jumpedRef.current = true;
        const mark = marksRef.current[currentId];
        let start = 0;
        if (mark && typeof mark.offsetLeft === 'number' && step > 0) {
          start = Math.round(mark.offsetLeft / step);
        }
        start = Math.max(0, Math.min(start, total - 1));
        pageRef.current = start;
        setPage(start);
        // 开场这一跳必须瞬间到位：`scroll-behavior:smooth` 会让书从第一页
        // 滑到一半，看起来像是自己翻了几页。
        const wasBehavior = flow.style.scrollBehavior;
        flow.style.scrollBehavior = 'auto';
        flow.scrollLeft = Math.round(start * step);
        flow.style.scrollBehavior = wasBehavior;
      } else {
        setPage((cur) => {
          const next = Math.max(0, Math.min(cur, total - 1));
          pageRef.current = next;
          return next;
        });
      }
    }, [fontSize, currentId]);

    React.useLayoutEffect(() => {
      measure();
      // 首帧之后再量一次：字体还没落地的面板里，第一次测量可能偏小。
      const raf = window.requestAnimationFrame(() => {
        const flow = flowRef.current;
        if (!flow) return;
        if (flow.scrollWidth <= flow.clientWidth + 4) measure();
      });
      const stage = stageRef.current;
      let ro = null;
      if (stage && typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => measure());
        try {
          ro.observe(stage);
        } catch (err) {
          /* ignore */
        }
      }
      const onResize = () => measure();
      window.addEventListener('resize', onResize);
      return () => {
        if (raf) window.cancelAnimationFrame(raf);
        if (ro) {
          try {
            ro.disconnect();
          } catch (err) {
            /* ignore */
          }
        }
        window.removeEventListener('resize', onResize);
      };
    }, [measure]);

    // 手指/滚轮直接横向滚（触控板横滑、手机横拖）也要让页码跟上。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return undefined;
      let snapTimer = 0;
      const onScroll = () => {
        if (scrollRafRef.current) return;
        scrollRafRef.current = window.requestAnimationFrame(() => {
          scrollRafRef.current = 0;
          const s = step;
          if (!s) return;
          // 自己滚的那一段不参与：页码已经由 go()/scrollToPage() 定好了。
          if (Date.now() < quietRef.current) return;
          const index = Math.round(flow.scrollLeft / s);
          if (index !== pageRef.current) {
            pageRef.current = index;
            setPage(index);
          }
          // 手指停下来之后把页面对齐到整页：多栏布局没有 scroll-snap 可依（页
          // 不是元素），停在半页上读起来像被人挪了一下椅子。吸附也走同一条滑
          // 动，短距离 190ms，读起来是「轻轻一推」而不是突然跳过去。
          window.clearTimeout(snapTimer);
          snapTimer = window.setTimeout(() => {
            if (Date.now() < quietRef.current) return;
            const drift = flow.scrollLeft - Math.round(pageRef.current * s);
            if (Math.abs(drift) > 2) slideToPage(pageRef.current);
          }, 170);
        });
      };
      flow.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        window.clearTimeout(snapTimer);
        flow.removeEventListener('scroll', onScroll);
      };
    }, [step, scrollToPage, slideToPage]);

    // 滚轮 / 触控板：竖着滚也要翻页。横向滚动容器对竖向滚轮没有反应，
    // 而看书的人不会先想一想该往哪个方向滚。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return undefined;
      const onWheel = (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const dx = ev.deltaX || 0;
        const dy = ev.deltaY || 0;
        // 触控板的横向滑动交给浏览器自己滚，页码由 scroll 监听器跟上。
        if (Math.abs(dx) > Math.abs(dy)) return;
        ev.preventDefault();
        const acc = wheelRef.current;
        const now = Date.now();
        if (now - acc.at > 160) acc.acc = 0;
        acc.at = now;
        acc.acc += dy;
        const threshold = 40;
        if (Math.abs(acc.acc) < threshold) return;
        const delta = acc.acc > 0 ? 1 : -1;
        acc.acc = 0;
        go(delta);
      };
      flow.addEventListener('wheel', onWheel, { passive: false });
      return () => flow.removeEventListener('wheel', onWheel);
    }, [go]);

    // 键盘：方向键翻页，Home/End 到首尾。Esc 由 useModalEscape 负责。
    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.defaultPrevented) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        // 焦点在按钮/输入框上时，空格与方向键是那个控件的，不是翻页的。
        const node = ev.target;
        if (node && typeof node.closest === 'function' && node.closest('button, input, textarea, select')) return;
        const key = ev.key;
        if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
          ev.preventDefault();
          go(1);
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
          ev.preventDefault();
          go(-1);
          return;
        }
        if (key === 'Home') {
          ev.preventDefault();
          go(-maxPage - 1);
          return;
        }
        if (key === 'End') {
          ev.preventDefault();
          go(maxPage + 1);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [go, maxPage]);

    // 角落的提示会自己走开：留下来的是书，不是说明书。
    React.useEffect(() => {
      const timer = window.setTimeout(() => setHintOn(false), 5200);
      return () => window.clearTimeout(timer);
    }, []);

    // 点左侧回一页、点右侧翻一页。拖动/选字/点标注都不算点。
    const onPointerDown = (ev) => {
      const node = ev.target;
      // 点在标注、工具条或批注面板上时，这一下是给它们的，不是翻页的。
      // 记下来在 pointerup 里用：一次点击会先 pointerup 再 click，如果 up 里
      // 就翻了页，等 click 打开批注时书已经跳到下一页了。
      const onSomething = !!(node && typeof node.closest === 'function'
        && node.closest('.nw-mark[data-mark], .nw-mark-bar, .nw-mark-pop, .nw-mark-side, .nw-read-gutter'));
      pointerRef.current = { x: ev.clientX, y: ev.clientY, onSomething: onSomething };
    };
    const onPointerUp = (ev) => {
      const down = pointerRef.current;
      pointerRef.current = null;
      // R53g：这一下按下时收掉了某个面板，那它到此为止——不再翻页。只认紧跟着
      // 的那一次（600ms 内），否则点在正文外没收到 pointerup 时会一直吞翻页。
      if (dismissedRef.current && Date.now() - dismissedRef.current < 600) {
        dismissedRef.current = 0;
        return;
      }
      dismissedRef.current = 0;
      if (!down) return;
      if (Math.abs(ev.clientX - down.x) > 8 || Math.abs(ev.clientY - down.y) > 8) {
        // 拖了一下 = 想标注这段字，不是想翻页。从已有标注上起手也一样：
        // 谁都会从一条下划线中间开始往外拖。
        const hit = readSelection();
        if (hit) {
          // R53：又划了一段新字，默认是要处理新选区——便签里那条草稿收起来，
          // 免得「框还停在上一句旁边」。
          if (composer) {
            setComposer(null);
            setComposerNote('');
          }
          setSel(hit);
        }
        return;
      }
      // 没动 = 一次点击。点在标注、工具条或批注面板上时这一下是给它们的，
      // 不是翻页的：一次点击会先 pointerup 再 click，若在 up 里就翻了页，
      // 等 click 打开批注时书已经跳到下一页了。
      if (down.onSomething) return;
      const s0 = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s0 && String(s0.toString() || '').length > 0) return;
      // 便签还开着时点正文这一下已经在 pointerdown 里收起（并保存）了，不再翻页。
      setSel(null);
      const flow = flowRef.current;
      if (!flow) return;
      const rect = flow.getBoundingClientRect();
      if (ev.clientX >= rect.left + rect.width * 0.5) go(1);
      else go(-1);
    };

    // 整本书拆段是这里唯一的重活：一本二十万字的稿子要走两万行。翻页只改
    // `page`、提示五秒后只改 `hintOn`，两者都会重渲染本组件——所以正文必须
    // 缓存住，否则每翻一页都要把全书重新拆一遍。
    const body = React.useMemo(() => {
      if (!chapters.length) {
        return h('div', { className: 'nw-read-empty' }, h('span', null, NW.t('这本书还没有正文')));
      }
      const byChapter = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        const key = String(m.chapterId || '');
        if (!key) continue;
        if (!byChapter[key]) byChapter[key] = [];
        byChapter[key].push(m);
      }
      return chapters.map((row, index) => {
        const key = String(row.id);
        const own = byChapter[key] || [];
        return h(
          'section',
          {
            className: 'nw-read-chapter',
            key: key,
            'data-chapter-id': key,
            'data-first': index === 0 ? '1' : '0',
            ref: (el) => {
              if (el) marksRef.current[key] = el;
              else delete marksRef.current[key];
            },
          },
          isPlaceholderTitle(row.title)
            ? null
            : h('h2', { className: 'nw-read-title' }, String(row.title)),
          paragraphsOf(
            currentId != null && key === currentId && currentText != null
              ? currentText
              : row.content,
          ).map((para, i) =>
            h(
              'p',
              {
                className: 'nw-read-p',
                key: String(i),
                // 原文里的空行在这里变成「这段之前空了一行」，读起来才是作者
                // 写作时划分的场景，而不是被压平的段落墙。
                'data-gap': para.gap ? '1' : '0',
                // 这段第一个字在章节全文里的下标：选区要靠它反推成标注区间。
                'data-start': String(para.start),
              },
              own.length ? splitByMarks(para, own) : para.text,
            ),
          ),
        );
      });
    }, [chapters, currentId, currentText, marks]);

    // 正文重建后立刻重算页边批注签；`body` 变了说明分段/换页规则也可能变了。
    React.useLayoutEffect(() => {
      paintGutterRef.current = paintGutter;
      paintGutter();
    }, [paintGutter, body]);

    React.useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return undefined;
      let timer = 0;
      const relayout = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const fn = paintGutterRef.current;
          if (typeof fn === 'function') fn();
        }, 90);
      };
      flow.addEventListener('scroll', relayout, { passive: true });
      window.addEventListener('resize', relayout);
      return () => {
        window.clearTimeout(timer);
        flow.removeEventListener('scroll', relayout);
        window.removeEventListener('resize', relayout);
      };
    }, []);

    const flowStyle = {
      fontSize: fontSize + 'px',
      lineHeight: String(lineHeight),
    };

    // 选中一段字之后浮出来的小工具条：就四个动作，不下拉、不弹窗。
    // 便签开着的时候收起来：那一版的选区已经交给便签了，再叠一个条子只是噪音。
    const toolbar = sel && !composer
      ? h(
        'div',
        {
          className: 'nw-mark-bar',
          role: 'toolbar',
          'aria-label': NW.t('标注'),
          style: {
            left: Math.round(Math.max(12, sel.x)) + 'px',
            top: Math.round(Math.max(8, sel.y - 44)) + 'px',
          },
        },
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: () => addMark('underline'),
          title: NW.t('下划线'),
        }, NW.t('下划线')),
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: () => addMark('strike'),
          title: NW.t('删除线'),
        }, h('span', { style: { textDecoration: 'line-through' } }, NW.t('删除线'))),
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: openComposer,
          title: NW.t('写批注'),
        }, NW.t('批注')),
      )
      : null;

    // R53：浮层一律贴着点击处，而不是贴着那一行的下沿。
    // 横向：先试点击处**右边**一拳的地方（不盖住刚点的那几个字），右边放不下
    // 就翻到左边；`translateX(-50%)` 在 CSS 里，所以这里算的是中心点。
    // 纵向：和点击处大致齐平，底边放不下就整体上提，永远夹在视口里。
    const placeNear = (at, w, h) => {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
      const x = at && Number.isFinite(at.x) ? at.x : vw / 2;
      const y = at && Number.isFinite(at.y) ? at.y : vh / 2;
      const side = 14;
      let center = x + side + w / 2;
      if (center + w / 2 > vw - 8) center = x - side - w / 2;
      const left = Math.min(Math.max(center, w / 2 + 8), vw - w / 2 - 8);
      let top = y - 12;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 10);
      if (top < 8) top = 8;
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' };
    };

    const picker = picked
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-pick',
          role: 'toolbar',
          'aria-label': NW.t('这条标注'),
          style: placeNear(picked, 140, 34),
        },
        h(
          'div',
          { className: 'nw-mark-pop-acts' },
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-danger': '1',
            onClick: () => {
              const id = picked.mark.id;
              closeMark();
              if (typeof p.onUnmark === 'function') p.onUnmark(id);
            },
          }, NW.t('删除')),
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            onClick: () => {
              // 不调 closeMark()：那会顺手把刚刚点亮的标注也熄灭，而编辑框还开着，
              // 亮着才对得上「我在改这一条」。
              const at = picked;
              setPicked(null);
              setNoteDraft(String(at.mark.note || ''));
              setEditing({ mark: at.mark, x: at.x, y: at.y });
            },
          }, NW.t('写批注')),
        ),
      )
      : null;

    const editor = editing
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-edit',
          role: 'dialog',
          'aria-label': NW.t('批注'),
          style: placeNear(editing, 196, 96),
        },
        h('textarea', {
          ref: noteRef,
          className: 'nw-mark-pop-note',
          value: noteDraft,
          rows: 1,
          placeholder: NW.t('这条批注写给自己看'),
          'aria-label': NW.t('批注'),
          autoFocus: true,
          // R53g：没有保存键。打字即存（700ms 合并一次），收起时补最后一次。
          onChange: (ev) => {
            const body = ev.target.value;
            setNoteDraft(body);
            scheduleNote(editing.mark.id, body);
          },
          onBlur: () => flushNote(),
          onKeyDown: (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              // 收起就是保存：先补最后一次，再关。
              flushNote();
              closeMark();
            }
          },
        }),
        h(
          'div',
          { className: 'nw-mark-pop-acts' },
          // R51：批注窗里也能删。R53g 之后这里是唯一一颗按钮——保存和取消都没了。
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-danger': '1',
            title: NW.t('删掉这条标注'),
            onClick: () => {
              const id = editing.mark.id;
              // 先作废待写的这一次，否则「存完再删」会把刚删的行又写回来。
              dropNote();
              closeMark();
              if (typeof p.onUnmark === 'function') p.onUnmark(id);
            },
          }, NW.t('删除')),
        ),
        // R53e：文字只属于批注。这句话在这里被写成批注，就等于它从「一条下划线」
        // 变成「一条批注」——同一句话不可能同时是两样东西。所以窗里说清楚这件事，
        // 而不是让作者以为自己在一条下划线上贴了一张便签。本来已经是批注的不必说。
        String(editing.mark.kind) === 'comment'
          ? null
          : h(
            'div',
            { className: 'nw-mark-pop-hint' },
            NW.t('写下字，这句话就是一条批注'),
          ),
      )
      : null;

    // R53：新批注的便签。一行高起步，随字长高（最多三行半），位置贴着选区
    // ——不是屏幕正中那块大面板。R53g：同样没有保存键，第一次出现非空文字时
    // 才建行（空着关掉就当没写过，不留一条没有话的批注）。
    const composerBox = composer
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-edit',
          role: 'dialog',
          'aria-label': NW.t('批注'),
          style: placeNear(composer, 196, 96),
        },
        h('textarea', {
          ref: composerRef,
          className: 'nw-mark-pop-note',
          value: composerNote,
          rows: 1,
          placeholder: NW.t('这条批注写给自己看'),
          'aria-label': NW.t('批注'),
          autoFocus: true,
          onChange: (ev) => {
            const body = ev.target.value;
            setComposerNote(body);
            const st = composerSaveRef.current;
            st.draft = {
              chapterId: composer.chapterId,
              start: composer.start,
              end: composer.end,
              quote: composer.quote,
            };
            st.body = body;
            scheduleComposer(body);
          },
          onBlur: () => commitComposer(),
          onKeyDown: (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              commitComposer();
              closeComposer();
            }
          },
        }),
      )
      : null;

    // 两个批注输入框都随内容长高：先复位成 auto 再读 scrollHeight，否则只增不减。
    React.useLayoutEffect(() => {
      const grow = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(64, Math.max(24, el.scrollHeight)) + 'px';
      };
      grow(noteRef.current);
      grow(composerRef.current);
    }, [noteDraft, composerNote, editing, composer]);

    return h(
      'div',
      {
        className: 'nw-read nw-surface',
        'data-theme': themeKey,
        'data-read': '1',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': NW.t('读一遍'),
      },
      h(
        'div',
        { className: 'nw-read-bar' },
        h('span', { className: 'nw-read-bar-name' }, novelTitle || NW.t('读一遍')),
        h(
          'button',
          {
            type: 'button',
            className: 'nw-read-bar-close',
            'aria-label': NW.t('回到写作') + '（Esc）',
            title: NW.t('回到写作') + '（Esc）',
            onClick: close,
          },
          NW.icon('x', { size: 16 }),
        ),
      ),
      h(
        'div',
        { className: 'nw-read-stage', ref: stageRef },
        h(
          'div',
          {
            className: 'nw-read-flow',
            ref: flowRef,
            style: flowStyle,
            tabIndex: -1,
            onPointerDown,
            onPointerUp,
            onClick: (ev) => {
              const node = ev.target;
              if (node && typeof node.closest === 'function') {
                const span = node.closest('.nw-mark[data-mark]');
                if (span) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  openMark(span.getAttribute('data-mark'), ev);
                  return;
                }
              }
              // 点空白处收起面板这件事已经由 document 上的 pointerdown 统一处理
              // （R53g：要覆盖顶栏、页脚、页边签在内的「任何地方」），这里只负责
              // 「点在标注上就打开它」。
            },
          },
          body,
        ),
        h('div', { className: 'nw-read-gutter', ref: gutterRef }),
        toolbar,
        picker,
        composerBox,
        editor,
      ),
      h(
        'div',
        { className: 'nw-read-foot' },
        h(
          'span',
          { className: 'nw-read-hint', 'data-fade': hintOn ? '0' : '1' },
          '← → 翻页 · 选字可以标注 · Esc 回到写作',
        ),
        h('span', { className: 'nw-read-count' }, String(page + 1) + ' / ' + String(Math.max(1, layout.total))),
      ),
    );
  };
})();
