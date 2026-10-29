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
      // piece. Only the piece that holds the mark's real end may carry the
      // little comment badge, otherwise a two-paragraph comment would sprout two.
      // R50: a note is no longer its own kind — any underline or strike can carry
      // one, so the badge follows `note`, not `kind`.
      if (e > s) {
        hits.push({
          s: s - start,
          e: e - start,
          kind: m.kind,
          id: m.id,
          tail: e >= (Number(m.end) || 0),
          badge: !!String(m.note || '').trim() || String(m.kind) === 'comment',
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
      // R49：角标挂在**字尾**，不是行尾。这个零宽零高的锚点紧跟在最后那个字
      // 后面，所以它落在文字结束处；它不占排版空间，分页一个像素都不变。
      // R50：角标自己带着 `data-mark`，点它等于点那条标注。
      if (m.badge && m.tail) {
        out.push(h('span', {
          className: 'nw-mark nw-mark-dot',
          key: 'd' + i + '-' + String(m.id),
          'data-mark': String(m.id),
          role: 'button',
          tabIndex: -1,
          'aria-label': NW.t('批注'),
        }));
      }
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
/* The paged column. Width is written by the component (--nw-read-w) because
   column-width accepts lengths only, never percentages. */
.nw-read-flow{
  position:relative;
  width:var(--nw-read-w,680px);height:100%;
  column-width:var(--nw-read-w,680px);
  column-gap:clamp(28px,5vw,64px);
  column-fill:auto;
  overflow-x:auto;overflow-y:hidden;
  overscroll-behavior-x:contain;
  scrollbar-width:none;-ms-overflow-style:none;
  scroll-behavior:smooth;
  color:var(--nw-fg);
  outline:none;
}
.nw-read-flow::-webkit-scrollbar{width:0;height:0;}
.nw-read-flow[data-drag="1"]{cursor:grabbing;}
.nw-read-chapter{margin:0;}
.nw-read-chapter + .nw-read-chapter{break-before:column;}
.nw-read-title{
  margin:0 0 1.6em;padding-bottom:.7em;
  border-bottom:1px solid var(--nw-rule);
  text-align:center;font-size:1.16em;font-weight:600;
  line-height:1.5;letter-spacing:.04em;color:var(--nw-fg);
  break-after:avoid;
}
.nw-read-p{
  margin:0 0 .9em;text-indent:2em;
  white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;
  text-align:left;
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
.nw-mark[data-active="1"]{background-color:color-mix(in srgb, var(--nw-brand) 22%, transparent);}
/* 选中的标注：用外描边而不是换色，正文颜色始终是作者的字色。 */
.nw-mark[data-selected="1"]{outline:1px solid color-mix(in srgb, var(--nw-brand) 55%, transparent);outline-offset:1px;}
/* 批注角标：浮在划线末尾的一个小标识，说明这里挂了一条批注。
   R49 修位置：原来把它挂在片段自身的 left:100%，而片段的 100% 是**行盒**的
   末尾而不是文字的末尾 —— 批注一跨行，点就跑到上一行行尾去了，跨栏时还会被
   栏边界裁掉，看起来像是「没浮在所划线的末尾」。
   现在改成在片段的最后一个字后面插一个零宽零高的 inline-block 当锚点：它不占
   任何排版空间（所以分页、字距、换行一个像素都不变，这是整个标注功能的前提），
   位置却正好是文字的末尾，角标以它为基准绝对定位，就是「浮在字尾」。
   只有真正到达批注终点的那个片段才画（一条批注跨段时，段段都画就成了三个点）。 */
.nw-mark-dot{display:inline-block;width:0;height:0;position:relative;vertical-align:baseline;}
/* R50：标识改成一个「小方框里三个点」——像一张便条，而不是一个墨点。圆点只能
   说「这里有东西」，方框里三个点说的是一句话，而且和别处的批注图标是一个意思。
   框里的三个点是拿三枚径向渐变画的，不引入图标、不多一个 DOM 节点。 */
.nw-mark-dot::after{
  /* R52：角标挂在字尾的**右上角**。原来贴着字腰右侧，行高紧的时候正好压住
     下一行开头的几个字——用户说「有点遮挡文字」。右上角落在一行的上沿之外，
     行距里本来就有空白，字本身一个像素也不动。 */
  content:'';position:absolute;left:3px;top:-.86em;
  box-sizing:border-box;width:12px;height:9px;
  border-radius:2px;
  background-color:var(--nw-mark-comment, var(--nw-brand));
  background-image:
    radial-gradient(circle at 3px 50%, var(--nw-panel) .8px, transparent 1px),
    radial-gradient(circle at 6px 50%, var(--nw-panel) .8px, transparent 1px),
    radial-gradient(circle at 9px 50%, var(--nw-panel) .8px, transparent 1px);
  background-repeat:no-repeat;
  box-shadow:0 0 0 1px color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 26%, transparent);
  pointer-events:auto;cursor:pointer;
}
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
  z-index:35;width:min(220px,calc(100vw - 24px));
  display:flex;flex-direction:column;gap:4px;
  padding:6px;border-radius:var(--nw-r-control);
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
   用户说「编辑框太大」，所以宽度收到 176px、留白也收，让它真的像贴在字边上的便签。 */
.nw-mark-pop.nw-mark-edit{width:min(176px,calc(100vw - 24px));padding:5px;gap:3px;}
.nw-mark-pop-note{
  box-sizing:border-box;width:100%;min-height:28px;max-height:76px;
  padding:3px 5px;
  border-radius:var(--nw-r-hair);border:1px solid var(--nw-line);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);line-height:1.45;
  resize:none;
}
.nw-mark-pop-note:focus{outline:none;border-color:var(--nw-brand);}
.nw-mark-pop-btn[data-danger="1"]{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 45%, var(--nw-line-strong));}
@media (max-width: 560px){
  .nw-mark-bar-btn{padding:0 8px;}
  .nw-mark-pop{width:min(240px,calc(100vw - 16px));}
}
@media (prefers-reduced-motion: reduce){
  .nw-read{animation:none;}
  .nw-read-flow{scroll-behavior:auto;}
  .nw-mark-pop{animation:none;}
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
    const step = layout.w + layout.gap;

    const close = React.useCallback(() => {
      if (typeof p.onClose === 'function') p.onClose();
    }, [p.onClose]);

    // Esc 走弹层自己的栈（40-ui 的 useEscapeOwner）：一次 Esc 只关一层，
    // 也不会被沉浸模式的 Esc 抢先退出全屏。
    // R50：批注小窗开着时，Esc 先收小窗，再按一次才离开「读一遍」。
    NW.useModalEscape(true, () => {
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

    const scrollToPage = React.useCallback((index, smooth) => {
      const flow = flowRef.current;
      if (!flow) return;
      const s = layout.w + layout.gap;
      if (!s) return;
      // 让滚动监听器在这段时间里安静：平滑滚动要过好几百毫秒，中途每一帧的
      // scrollLeft 都落在两页之间，不屏蔽会把页码拖来拖去。
      quietRef.current = Date.now() + (smooth ? 620 : 90);
      try {
        flow.scrollTo({ left: Math.round(index * s), behavior: smooth ? 'smooth' : 'auto' });
      } catch (err) {
        flow.scrollLeft = Math.round(index * s);
      }
    }, [layout.w, layout.gap]);

    const go = React.useCallback((delta) => {
      // pageRef is the source of truth: the scroll listener writes it on every
      // swipe, so reading it here keeps clicks and keys in sync with the finger.
      const cur = pageRef.current;
      const next = Math.max(0, Math.min(maxPage, cur + delta));
      if (next === cur) return;
      pageRef.current = next;
      setPage(next);
      scrollToPage(next, true);
    }, [maxPage, scrollToPage]);

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
      setSel(null);
      const s = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s) s.removeAllRanges();
    }, [sel, p.onMark]);

    const addNote = React.useCallback(() => {
      const cur = sel;
      if (!cur) return;
      // R49: the UI layer exports this as `prompt`; asking for `promptAsync`
      // silently fell through to an empty string, so every new comment came
      // back empty and was dropped without a word.
      const ask = NW.ui && typeof NW.ui.prompt === 'function'
        ? NW.ui.prompt({
          title: NW.t('写一条批注'),
          label: NW.t('批注'),
          multiline: true,
          placeholder: NW.t('这条批注写给自己看'),
        })
        : Promise.resolve('');
      Promise.resolve(ask).then((note) => {
        if (note == null) return;
        const body = String(note).trim();
        if (!body) return;
        if (typeof p.onMark === 'function') {
          p.onMark({
            chapterId: cur.chapterId,
            kind: 'comment',
            start: cur.start,
            end: cur.end,
            quote: cur.text.slice(0, 240),
            note: body,
          });
        }
        setSel(null);
        const s = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (s) s.removeAllRanges();
      });
    }, [sel, p.onMark]);

    // 讲清楚「点一下标注会发生什么」：就在点的位置浮出两个小按钮——删除 / 批注。
    // 点亮那几个 `<span>` 用 DOM 直接改属性，不把 picked 塞进正文的 useMemo
    // 依赖——否则每点一次标注就要把全书重新拆一遍段（正是 R44 修掉的卡顿）。
    const openMark = React.useCallback((id, ev) => {
      const list = marks.filter((m) => String(m.id) === String(id));
      const mark = list[0];
      if (!mark) return;
      // 菜单贴着**那段字**走，不是贴着鼠标走：用户说的是「在所选文字旁边显示小框」，
      // 点在字的哪一处都该张在同一行的同一侧。一条标注在分栏/跨段时会拆成好几个
      // 片段，所以取所有片段的所有行盒，挑离点击点最近的那个——用并集会把框甩到
      // 相邻的栏上去。
      const flow = flowRef.current;
      let x = ev && typeof ev.clientX === 'number' ? ev.clientX : window.innerWidth / 2;
      let y = ev && typeof ev.clientY === 'number' ? ev.clientY : window.innerHeight / 2;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark="' + String(id) + '"]');
        let best = null;
        let bestDist = Infinity;
        for (let i = 0; i < spans.length; i += 1) {
          const rects = spans[i].getClientRects ? spans[i].getClientRects() : [];
          for (let k = 0; k < rects.length; k += 1) {
            const r = rects[k];
            if (!r || (!r.width && !r.height)) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dist = Math.abs(cx - x) + Math.abs(cy - y);
            if (dist < bestDist) { bestDist = dist; best = r; }
          }
        }
        if (best) {
          const width = Math.min(best.width, 160);
          x = best.left + width / 2;
          y = best.bottom;
        }
      }
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark]');
        for (let i = 0; i < spans.length; i += 1) {
          const on = spans[i].getAttribute('data-mark') === String(id);
          spans[i].setAttribute('data-active', on ? '1' : '0');
        }
      }
      // 点一条「批注」就是看/改那句话——它存在的意义就是那句话，不必再选一次。
      // 下划线和删除线则先问「删了它，还是给它写一句」，因为这两件事对一条线
      // 都说得通，而线本身并不暗示哪一个。
      if (String(mark.kind) === 'comment') {
        setPicked(null);
        setNoteDraft(String(mark.note || ''));
        setEditing({ mark: mark, x: x, y: y });
        return;
      }
      setEditing(null);
      setPicked({ mark: mark, x: x, y: y });
    }, [marks]);

    const closeMark = React.useCallback(() => {
      setPicked(null);
      setEditing(null);
      const flow = flowRef.current;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark]');
        for (let i = 0; i < spans.length; i += 1) spans[i].setAttribute('data-active', '0');
      }
    }, []);

    // ---- 量一次版面：定栏宽 → 读 scrollWidth → 得到页数 ----------------------
    const measure = React.useCallback(() => {
      const stage = stageRef.current;
      const flow = flowRef.current;
      if (!stage || !flow) return;
      const cs = window.getComputedStyle(stage);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = Math.max(240, stage.clientWidth - padX);
      // 一行 34 个汉字上下最像书，但不该越过面板宽度。
      const w = Math.floor(Math.min(34 * fontSize, avail));
      flow.style.setProperty('--nw-read-w', w + 'px');
      const gap = parseFloat(window.getComputedStyle(flow).columnGap) || 0;
      const s = w + gap;
      const total = Math.max(1, Math.round((flow.scrollWidth + gap) / s));
      setLayout({ w, gap, total });

      if (!jumpedRef.current) {
        jumpedRef.current = true;
        const mark = marksRef.current[currentId];
        let start = 0;
        if (mark && typeof mark.offsetLeft === 'number' && s > 0) {
          start = Math.round(mark.offsetLeft / s);
        }
        start = Math.max(0, Math.min(start, total - 1));
        pageRef.current = start;
        setPage(start);
        // 开场这一跳必须瞬间到位：`scroll-behavior:smooth` 会让书从第一页
        // 滑到一半，看起来像是自己翻了几页。
        const wasBehavior = flow.style.scrollBehavior;
        flow.style.scrollBehavior = 'auto';
        flow.scrollLeft = Math.round(start * s);
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
          const s = layout.w + layout.gap;
          if (!s) return;
          // 自己滚的那一段不参与：页码已经由 go()/scrollToPage() 定好了。
          if (Date.now() < quietRef.current) return;
          const index = Math.round(flow.scrollLeft / s);
          if (index !== pageRef.current) {
            pageRef.current = index;
            setPage(index);
          }
          // 手指停下来之后把页面对齐到整页：多栏布局没有 scroll-snap 可依（页
          // 不是元素），停在半页上读起来像被人挪了一下椅子。
          window.clearTimeout(snapTimer);
          snapTimer = window.setTimeout(() => {
            if (Date.now() < quietRef.current) return;
            const drift = flow.scrollLeft - Math.round(pageRef.current * s);
            if (Math.abs(drift) > 2) scrollToPage(pageRef.current, true);
          }, 170);
        });
      };
      flow.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        window.clearTimeout(snapTimer);
        flow.removeEventListener('scroll', onScroll);
      };
    }, [layout.w, layout.gap, scrollToPage]);

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
        && node.closest('.nw-mark[data-mark], .nw-mark-bar, .nw-mark-pop'));
      pointerRef.current = { x: ev.clientX, y: ev.clientY, onSomething: onSomething };
    };
    const onPointerUp = (ev) => {
      const down = pointerRef.current;
      pointerRef.current = null;
      if (!down) return;
      if (Math.abs(ev.clientX - down.x) > 8 || Math.abs(ev.clientY - down.y) > 8) {
        // 拖了一下 = 想标注这段字，不是想翻页。从已有标注上起手也一样：
        // 谁都会从一条下划线中间开始往外拖。
        const hit = readSelection();
        if (hit) setSel(hit);
        return;
      }
      // 没动 = 一次点击。点在标注、工具条或批注面板上时这一下是给它们的，
      // 不是翻页的：一次点击会先 pointerup 再 click，若在 up 里就翻了页，
      // 等 click 打开批注时书已经跳到下一页了。
      if (down.onSomething) return;
      const s0 = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s0 && String(s0.toString() || '').length > 0) return;
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

    const flowStyle = {
      fontSize: fontSize + 'px',
      lineHeight: String(lineHeight),
    };

    // 选中一段字之后浮出来的小工具条：就四个动作，不下拉、不弹窗。
    const toolbar = sel
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
          onClick: addNote,
          title: NW.t('批注'),
        }, NW.t('批注')),
      )
      : null;

    // R50：点一条标注 → 就在点的位置浮出两个并列的小按钮（删除 / 批注）。
    // 点「删除」这条线立刻没了；点「批注」就在同一个位置张开一个贴着字的小编辑框。
    // 位置一律夹在视口里，贴着底边或右边点时菜单不会跑到屏幕外面去。
    const anchorOf = (at, w, h) => {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
      const left = Math.min(Math.max(at.x, w / 2 + 8), vw - w / 2 - 8);
      // 优先张在字的下方（贴着那一行）；下面放不下就翻到上方。
      const below = at.y + 8;
      const top = below + h > vh - 8 ? Math.max(8, at.y - h - 20) : below;
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' };
    };

    const picker = picked
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-pick',
          role: 'toolbar',
          'aria-label': NW.t('这条标注'),
          style: anchorOf(picked, 140, 34),
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
          }, NW.t('批注')),
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
          style: anchorOf(editing, 176, 116),
        },
        h('textarea', {
          className: 'nw-mark-pop-note',
          value: noteDraft,
          placeholder: NW.t('这条批注写给自己看'),
          'aria-label': NW.t('批注'),
          autoFocus: true,
          onChange: (ev) => setNoteDraft(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              closeMark();
            }
          },
        }),
        h(
          'div',
          { className: 'nw-mark-pop-acts' },
          // R51：批注窗里也能删。原先只有「取消/保存」，想扔掉一条批注得先关掉窗
          // 再点那条线，而线在窗下面，点不到——于是那条批注永远删不掉。
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-danger': '1',
            title: NW.t('删掉这条标注'),
            onClick: () => {
              const id = editing.mark.id;
              closeMark();
              if (typeof p.onUnmark === 'function') p.onUnmark(id);
            },
          }, NW.t('删除')),
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            onClick: closeMark,
          }, NW.t('取消')),
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-primary': '1',
            onClick: () => {
              const id = editing.mark.id;
              const body = String(noteDraft || '').trim();
              closeMark();
              if (typeof p.onNote === 'function') p.onNote(id, body);
            },
          }, NW.t('保存')),
        ),
      )
      : null;

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
              // 点空白处收起面板。
              if (picked || editing) closeMark();
            },
          },
          body,
        ),
        toolbar,
        picker,
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
