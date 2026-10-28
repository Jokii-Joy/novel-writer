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
   */
  function paragraphsOf(text) {
    const out = [];
    const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    let blank = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) {
        blank += 1;
        continue;
      }
      // 第一段前面的空行没有意义（正文开头本来就留白）。
      out.push({ text: line, gap: out.length > 0 && blank > 0 });
      blank = 0;
    }
    return out;
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
@media (prefers-reduced-motion: reduce){
  .nw-read{animation:none;}
  .nw-read-flow{scroll-behavior:auto;}
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
    NW.useModalEscape(true, close);

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

    // 点左侧回一页、点右侧翻一页。拖动/选字不算点。
    const onPointerDown = (ev) => {
      pointerRef.current = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev) => {
      const down = pointerRef.current;
      pointerRef.current = null;
      if (!down) return;
      if (Math.abs(ev.clientX - down.x) > 8 || Math.abs(ev.clientY - down.y) > 8) return;
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (sel && String(sel.toString() || '').length > 0) return;
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
      return chapters.map((row, index) =>
        h(
          'section',
          {
            className: 'nw-read-chapter',
            key: String(row.id),
            'data-first': index === 0 ? '1' : '0',
            ref: (el) => {
              const key = String(row.id);
              if (el) marksRef.current[key] = el;
              else delete marksRef.current[key];
            },
          },
          isPlaceholderTitle(row.title)
            ? null
            : h('h2', { className: 'nw-read-title' }, String(row.title)),
          paragraphsOf(
            currentId != null && String(row.id) === currentId && currentText != null
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
              },
              para.text,
            ),
          ),
        ),
      );
    }, [chapters, currentId, currentText]);

    const flowStyle = {
      fontSize: fontSize + 'px',
      lineHeight: String(lineHeight),
    };

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
          },
          body,
        ),
      ),
      h(
        'div',
        { className: 'nw-read-foot' },
        h(
          'span',
          { className: 'nw-read-hint', 'data-fade': hintOn ? '0' : '1' },
          '← → 翻页 · Esc 回到写作',
        ),
        h('span', { className: 'nw-read-count' }, String(page + 1) + ' / ' + String(Math.max(1, layout.total))),
      ),
    );
  };
})();
