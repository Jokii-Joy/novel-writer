;(() => {
  'use strict';

  const EMPTY = [];
  const SEP = '\u0001';
  const INDENT_STEP = 14;
  const MAX_INDENT_DEPTH = 8;
  const SEARCH_DEBOUNCE_MS = 300;
  const SEARCH_RESULT_LIMIT = 240;
  const SNIPPET_RADIUS = 28;

  /** 所有可见文案都走 NW.t；字典缺项时中文 key 本身就是回退值。 */
  function tr(key) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (typeof NW.t === 'function') return NW.t.apply(null, [key].concat(args));
    let out = String(key);
    for (let i = 0; i < args.length; i += 1) {
      out = out.replace(new RegExp('\\{' + i + '\\}', 'g'), String(args[i]));
    }
    return out;
  }

  function fmtDate(ms) {
    return typeof NW.fmtDate === 'function' ? NW.fmtDate(ms) : '';
  }

  function fmtWords(n) {
    if (typeof NW.fmtWords === 'function') return NW.fmtWords(n);
    return String(Number(n) || 0);
  }

  function sameId(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  // ---------------------------------------------------------------- icons ---
  const ICON_PATHS = {
    plus: ['M8 3.2v9.6', 'M3.2 8h9.6'],
    pencil: ['M11.1 2.4l2.5 2.5-8 8-3.2.7.7-3.2z', 'M9.5 4l2.5 2.5'],
    trash: ['M2.8 4.2h10.4', 'M6.1 4.2V2.8h3.8v1.4', 'M4.2 4.2l.6 9h6.4l.6-9', 'M6.6 6.6v4.2', 'M9.4 6.6v4.2'],
    child: ['M4 3.2v3.6a2 2 0 0 0 2 2h4.2', 'M8.4 6.6l2 2.2-2 2.2'],
    book: ['M3.4 2.6h6.6a2 2 0 0 1 2 2v9H5.4a2 2 0 0 1-2-2z', 'M3.4 11.6h8.6'],
    caret: ['M6.2 3.8l4.4 4.2-4.4 4.2'],
    x: ['M4.2 4.2l7.6 7.6', 'M11.8 4.2l-7.6 7.6'],
    gear: [
      'M8 2.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2',
      'M8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4',
      'M8 1.2v1.2',
      'M8 13.6v1.2',
      'M1.2 8h1.2',
      'M13.6 8h1.2',
    ],
    more: ['M4 8h.01', 'M8 8h.01', 'M12 8h.01'],
    upload: ['M8 10.8V3.4', 'M5.2 6.2L8 3.4l2.8 2.8', 'M3.4 12.8h9.2'],
    download: ['M8 3.2v7.4', 'M5.2 7.8L8 10.6l2.8-2.8', 'M3.4 13.2h9.2'],
    chevleft: ['M9.6 3.6L6 8l3.6 4.4'],
  };

  function icon(name, size, weight) {
    // R5: one shared icon set (42-icons.js) so the shelf, the dock and the
    // dialogs can never drift apart. The local table below stays only as a
    // fallback for a build where 42-icons.js is missing.
    if (typeof NW.icon === 'function') {
      return NW.icon(name, { size: size || 13, weight: weight || 1.5 });
    }
    const paths = ICON_PATHS[name] || EMPTY;
    const px = size || 13;
    return h(
      'svg',
      {
        viewBox: '0 0 16 16',
        width: px,
        height: px,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: weight || 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block', flex: '0 0 auto', pointerEvents: 'none' },
      },
      paths.map((d, i) => h('path', { key: i, d })),
    );
  }

  // ------------------------------------------------------------ NW.ui glue --
  // 控件优先用 lead 的 NW.ui 原语；若 40-ui.js 尚未装载则退回朴素实现，
  // 保证本 part 单独构建也能渲染（正常运行路径始终是 NW.ui）。
  function uiImpl(name) {
    const ui = NW.ui;
    return ui && typeof ui[name] === 'function' ? ui[name] : null;
  }

  function makeBtn(cfg) {
    const c = cfg || {};
    const impl = uiImpl('btn');
    if (impl) return impl(c);
    return h(
      'button',
      {
        type: 'button',
        className: 'nw-shelf-btn-fallback' + (c.kind === 'primary' ? ' is-primary' : ''),
        title: c.title || undefined,
        'aria-label': c.title || undefined,
        disabled: !!c.disabled,
        onClick: c.onClick,
        style: c.style,
      },
      c.children,
    );
  }

  function makeIconBtn(label, title, onClick) {
    const impl = uiImpl('iconBtn');
    if (impl) return impl(label, title, onClick);
    return h(
      'button',
      { type: 'button', className: 'nw-shelf-iconbtn', title: title || undefined, 'aria-label': title || undefined, onClick },
      label,
    );
  }

  function makeInput(cfg) {
    const c = cfg || {};
    const impl = uiImpl('input');
    if (impl) return impl(c);
    return h('input', {
      className: 'nw-shelf-input',
      type: 'text',
      value: c.value == null ? '' : c.value,
      placeholder: c.placeholder,
      'aria-label': c['aria-label'],
      onChange: c.onChange,
      onKeyDown: c.onKeyDown,
      autoFocus: !!c.autoFocus,
    });
  }

  function makeEmpty(text) {
    const impl = uiImpl('empty');
    if (impl) return impl(text);
    return h('p', { className: 'nw-shelf-empty-text' }, text);
  }

  function toast(message) {
    const impl = uiImpl('toast');
    if (!impl) return;
    try {
      impl(message, 'info');
    } catch (err) {
      /* 提示失败不阻塞交互 */
    }
  }

  /** NW.ui.input 的 onChange 可能是事件也可能是字符串，统一取值。 */
  function readValue(ev) {
    if (typeof ev === 'string') return ev;
    if (ev && ev.target && typeof ev.target.value === 'string') return ev.target.value;
    return '';
  }

  function readDragSrc(ev, remembered) {
    if (remembered != null && remembered !== '') return remembered;
    try {
      const dt = ev && ev.dataTransfer;
      if (!dt) return null;
      return dt.getData('text/nw-chapter') || dt.getData('text/plain') || null;
    } catch (err) {
      return null;
    }
  }

  function bucketKey(novelId, parentId) {
    return String(novelId == null ? '' : novelId) + SEP + (parentId == null || parentId === '' ? '' : String(parentId));
  }

  function rectOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    return el.getBoundingClientRect();
  }

  /** 上半部=插到之前，下半部=插到之后。 */
  function readSide(rect, clientY) {
    if (!rect) return true;
    return clientY < rect.top + rect.height / 2;
  }

  /** 把命中处高亮成 <mark>；未命中返回纯文本。 */
  function highlightText(text, lower) {
    const src = String(text == null ? '' : text);
    if (!lower) return src;
    const at = src.toLowerCase().indexOf(lower);
    if (at < 0) return src;
    return [
      src.slice(0, at),
      h('mark', { key: 'hit', className: 'nw-shelf-hit' }, src.slice(at, at + lower.length)),
      src.slice(at + lower.length),
    ];
  }

  /** 正文命中片段：命中词前后各取一小段，换行折叠为空格。 */
  function buildSnippet(text, lower) {
    const src = String(text == null ? '' : text);
    if (!src || !lower) return null;
    const at = src.toLowerCase().indexOf(lower);
    if (at < 0) return null;
    const start = Math.max(0, at - SNIPPET_RADIUS);
    const end = Math.min(src.length, at + lower.length + SNIPPET_RADIUS);
    const clean = (s) => s.replace(/[\r\n\t]+/g, ' ');
    return {
      prefix: (start > 0 ? '…' : '') + clean(src.slice(start, at)),
      hit: clean(src.slice(at, at + lower.length)),
      suffix: clean(src.slice(at + lower.length, end)) + (end < src.length ? '…' : ''),
    };
  }

  // ------------------------------------------------------------ chapter row --
  // 行是 React.memo 组件：展开/折叠/拖拽都不会重渲无关行。
  // 操作按钮只在悬停或聚焦时挂载，2000 章时不会一次性生成上千个 SVG。
  const ShelfRow = React.memo(function ShelfRow(p) {
    const ch = p.ch;
    const api = p.api;
    const [hovered, setHovered] = React.useState(false);
    const title = ch.title || tr('未命名章节');
    const classes = ['nw-shelf-row'];
    if (p.active) classes.push('is-active');
    // 菜单打开期间即使鼠标移出也保持动作条可见，否则锚点按钮会被卸载。
    const showActions = hovered || !!p.menuOpen;
    return h(
      'div',
      {
        className: classes.join(' '),
        style: { paddingLeft: 6 + Math.min(p.depth, MAX_INDENT_DEPTH) * INDENT_STEP },
        role: 'treeitem',
        'aria-level': p.depth + 1,
        'aria-selected': p.active ? 'true' : undefined,
        'aria-expanded': p.hasKids ? (p.collapsed ? 'false' : 'true') : undefined,
        draggable: true,
        tabIndex: 0,
        title,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setHovered(true),
        onBlur: (ev) => {
          const next = ev.relatedTarget;
          if (next && ev.currentTarget && ev.currentTarget.contains(next)) return;
          setHovered(false);
        },
        onDragStart: (ev) => api.dragStart(ev, ch),
        onDragEnd: () => api.dragEnd(),
        onDragOver: (ev) => api.dragOver(ev, ch),
        onDrop: (ev) => api.drop(ev, ch),
        onClick: () => api.select(ch.id),
        onDoubleClick: () => api.rename(ch),
        onKeyDown: (ev) => api.keyDown(ev, ch, p.hasKids, p.collapsed),
      },
      p.hasKids
        ? h(
            'span',
            {
              className: 'nw-shelf-caret',
              'data-open': p.collapsed ? '0' : '1',
              role: 'button',
              tabIndex: -1,
              'aria-label': p.collapsed ? tr('展开') : tr('折叠'),
              onMouseDown: (ev) => ev.preventDefault(),
              onClick: (ev) => {
                ev.stopPropagation();
                api.toggle(ch.id);
              },
            },
            icon('caret'),
          )
        : h('span', { className: 'nw-shelf-caret is-empty', 'aria-hidden': 'true' }),
      h('span', { className: 'nw-shelf-row-title' }, title),
      h('span', { className: 'nw-shelf-row-meta' }, fmtWords(ch.wordCount || 0)),
      showActions
        ? h(
            'span',
            { className: 'nw-row-actions', onClick: (ev) => ev.stopPropagation() },
            makeIconBtn(icon('child'), tr('新建子章节'), () => api.createChild(ch.id)),
            makeIconBtn(icon('pencil'), tr('重命名'), () => api.rename(ch)),
            makeIconBtn(icon('trash'), tr('删除'), () => api.remove(ch)),
            makeIconBtn(icon('more', 15), tr('更多操作'), (ev) => api.openMenu(ev, 'chapter', ch)),
          )
        : null,
    );
  });

  // ---------------------------------------------------------------- Shelf ---
  NW.Shelf = function Shelf(props) {
    const P = props || {};

    const [rawQuery, setRawQuery] = React.useState('');
    const [term, setTerm] = React.useState('');
    const [collapsedIds, setCollapsedIds] = React.useState(() => new Set());
    // 行内「更多操作」菜单：{kind:'novel'|'chapter', id, entity, x, y} 或 null。
    const [menu, setMenu] = React.useState(null);

    const dragIdRef = React.useRef(null);
    const hintRef = React.useRef(null);
    const indicatorRef = React.useRef(null);
    const scrollRef = React.useRef(null);
    const shelfRef = React.useRef(null);
    const menuRef = React.useRef(null);
    const sentTermRef = React.useRef('');
    const apiRef = React.useRef({});

    // ---------------------------------------------------- search (300ms) ----
    React.useEffect(() => {
      const timer = setTimeout(() => {
        setTerm(String(rawQuery == null ? '' : rawQuery).trim());
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }, [rawQuery]);

    React.useEffect(() => {
      if (sentTermRef.current === term) return;
      sentTermRef.current = term;
      if (typeof P.onSearch === 'function') P.onSearch(term);
    }, [term, P.onSearch]);

    // ------------------------------------------------------- action menu ----
    // 「⋯」菜单打开期间在捕获阶段监听 Escape 与外部点击；菜单自身在
    // menuRef 内，点菜单项不会触发关闭（关闭由菜单项的 onClick 自己做）。
    React.useEffect(() => {
      if (!menu) return undefined;
      const onKeyDown = (ev) => {
        if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
        ev.stopPropagation();
        setMenu(null);
      };
      const onPointerDown = (ev) => {
        const node = menuRef.current;
        if (node && ev.target && node.contains(ev.target)) return;
        setMenu(null);
      };
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('mousedown', onPointerDown, true);
      return () => {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('mousedown', onPointerDown, true);
      };
    }, [menu]);

    // 一次遍历构建 children map + 每部小说字数/章节数汇总；依赖 props.chapters 引用。
    const index = React.useMemo(() => {
      const list = Array.isArray(P.chapters) ? P.chapters : EMPTY;
      const byParent = new Map();
      const byId = new Map();
      const byNovel = new Map();
      const novelWords = new Map();
      const novelChapterCount = new Map();

      for (let i = 0; i < list.length; i += 1) {
        const ch = list[i];
        if (!ch || ch.id == null) continue;
        const nid = String(ch.novelId == null ? '' : ch.novelId);
        byId.set(ch.id, ch);
        let ofNovel = byNovel.get(nid);
        if (!ofNovel) {
          ofNovel = [];
          byNovel.set(nid, ofNovel);
        }
        ofNovel.push(ch);
        const key = bucketKey(nid, ch.parentId);
        let bucket = byParent.get(key);
        if (!bucket) {
          bucket = [];
          byParent.set(key, bucket);
        }
        bucket.push(ch);
        novelWords.set(nid, (novelWords.get(nid) || 0) + (Number(ch.wordCount) || 0));
        novelChapterCount.set(nid, (novelChapterCount.get(nid) || 0) + 1);
      }

      // 每个父级只排一次，总代价 O(n log n)，绝不逐行扫全表。
      const it = byParent.values();
      for (let step = it.next(); !step.done; step = it.next()) {
        step.value.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      }

      // 每部小说从根可达的节点集合：只算一次（只依赖 chapters），与折叠状态无关。
      // 用于把 parentId 指向不存在节点的"孤儿"章节挑出来兜底显示。
      const reachable = new Map();
      const novelIt = byNovel.keys();
      for (let ns = novelIt.next(); !ns.done; ns = novelIt.next()) {
        const nid = ns.value;
        const seen = new Set();
        const queue = [null];
        while (queue.length > 0) {
          const parentId = queue.pop();
          const bucket = byParent.get(bucketKey(nid, parentId));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i += 1) {
            const id = bucket[i].id;
            if (id == null) continue;
            const sk = String(id);
            if (seen.has(sk)) continue;
            seen.add(sk);
            queue.push(id);
          }
        }
        reachable.set(nid, seen);
      }

      return { byParent, byId, byNovel, reachable, novelWords, novelChapterCount };
    }, [P.chapters]);

    // 搜索：标题命中排前、正文命中排后，片段在渲染时截取。
    const search = React.useMemo(() => {
      if (!term) return null;
      const list = Array.isArray(P.chapters) ? P.chapters : EMPTY;
      const novels = Array.isArray(P.novels) ? P.novels : EMPTY;
      const lower = term.toLowerCase();
      const titleHits = [];
      const contentHits = [];
      const novelTitles = new Map();
      for (let i = 0; i < novels.length; i += 1) {
        if (novels[i] && novels[i].id != null) novelTitles.set(String(novels[i].id), novels[i].title || '');
      }
      for (let i = 0; i < list.length; i += 1) {
        if (titleHits.length + contentHits.length >= SEARCH_RESULT_LIMIT) break;
        const ch = list[i];
        if (!ch || ch.id == null) continue;
        const title = typeof ch.title === 'string' ? ch.title : '';
        if (title && title.toLowerCase().indexOf(lower) >= 0) {
          titleHits.push(ch);
          continue;
        }
        const content = typeof ch.content === 'string' ? ch.content : '';
        if (content && content.toLowerCase().indexOf(lower) >= 0) contentHits.push(ch);
      }
      return { lower, items: titleHits.concat(contentHits), novelTitles };
    }, [P.chapters, P.novels, term]);

    const novels = Array.isArray(P.novels) ? P.novels : EMPTY;
    const activeNovelId = P.activeNovelId == null ? null : P.activeNovelId;
    const activeChapterId = P.activeChapterId;

    // ---------------------------------------------------- drag indicator ----
    const placeIndicator = (rect, before) => {
      const node = indicatorRef.current;
      const scroller = scrollRef.current;
      if (!node || !scroller || !rect) return;
      const cr = rectOf(scroller);
      if (!cr) return;
      const top = Math.round(rect.top - cr.top + scroller.scrollTop + (before ? 0 : rect.height) - 1);
      node.style.top = Math.max(0, top) + 'px';
      node.style.opacity = '1';
    };

    const hideIndicator = () => {
      hintRef.current = null;
      if (indicatorRef.current) indicatorRef.current.style.opacity = '0';
    };

    // ---------------------------------------------------- move helpers ------
    const isUnder = (nodeId, ancestorId) => {
      let cur = nodeId;
      let guard = 0;
      while (cur != null && guard < 20000) {
        if (String(cur) === String(ancestorId)) return true;
        const node = index.byId.get(cur);
        if (!node) return false;
        cur = node.parentId == null ? null : node.parentId;
        guard += 1;
      }
      return false;
    };

    /** index 语义：从源父级摘除之后，在目标父级中的插入下标。 */
    const applyMove = (srcId, target, before) => {
      if (srcId == null || !target || sameId(srcId, target.id)) return;
      const targetParent = target.parentId == null ? null : target.parentId;
      // 拖进自身子树会成环，直接丢弃。
      if (targetParent != null && isUnder(targetParent, srcId)) return;
      const novelId = target.novelId == null ? activeNovelId : target.novelId;
      const siblings = index.byParent.get(bucketKey(novelId, targetParent)) || EMPTY;
      const at = siblings.findIndex((x) => sameId(x.id, target.id));
      let pos = at < 0 ? siblings.length : before ? at : at + 1;
      const srcAt = siblings.findIndex((x) => sameId(x.id, srcId));
      if (srcAt >= 0 && srcAt < pos) pos -= 1;
      if (typeof P.onMove === 'function') P.onMove(srcId, targetParent, Math.max(0, pos));
    };

    const appendToRoot = (srcId) => {
      if (srcId == null || activeNovelId == null) return;
      const roots = index.byParent.get(bucketKey(activeNovelId, null)) || EMPTY;
      let pos = roots.length;
      const srcAt = roots.findIndex((x) => sameId(x.id, srcId));
      if (srcAt >= 0) pos -= 1;
      if (typeof P.onMove === 'function') P.onMove(srcId, null, Math.max(0, pos));
    };

    // ------------------------------------------- stable row api (memo) -----
    // 同一个对象引用 + 每次 render 就地更新方法，memo 行既能跳过重渲又能拿到最新 props。
    const api = apiRef.current;
    api.select = (id) => {
      if (typeof P.onSelectChapter === 'function') P.onSelectChapter(id);
    };
    api.toggle = (id) => {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    api.createChild = (id) => {
      if (typeof P.onCreateChapter === 'function') P.onCreateChapter(id);
    };
    api.rename = (ch) => {
      if (typeof P.onRename === 'function') P.onRename('chapter', ch.id, ch.title || '');
    };
    api.remove = (ch) => {
      if (typeof P.onDelete === 'function') P.onDelete('chapter', ch.id);
    };
    // 菜单锚点用触发按钮的矩形定位：菜单贴着「⋯」按钮右缘下方弹出。
    // 菜单是侧栏内的绝对定位元素（.nw-shelf 的 overflow:hidden 会裁切），
    // 所以坐标要换算成侧栏内坐标，并按侧栏尺寸夹取；下方放不下时向上翻。
    api.openMenu = (ev, kind, entity) => {
      if (!entity || entity.id == null) return;
      const hostRect = rectOf(shelfRef.current);
      const rect = ev && ev.currentTarget ? rectOf(ev.currentTarget) : null;
      const menuW = 184;
      const menuH = 136;
      let x = 8;
      let y = 8;
      if (rect && hostRect) {
        x = Math.round(rect.right - hostRect.left);
        y = Math.round(rect.bottom - hostRect.top + 4);
        const maxX = Math.max(8, Math.round(hostRect.width) - menuW - 8);
        const maxY = Math.round(hostRect.height);
        if (maxY > 0 && y + menuH > maxY) {
          const flipped = Math.round(rect.top - hostRect.top) - menuH - 4;
          y = flipped >= 8 ? flipped : Math.max(8, maxY - menuH - 8);
        }
        x = Math.max(8, Math.min(x, maxX));
        if (maxY > 0) y = Math.max(8, Math.min(y, Math.max(8, maxY - menuH - 8)));
      }
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      setMenu((prev) =>
        prev && sameId(prev.id, entity.id) && prev.kind === kind
          ? null
          : { kind, id: entity.id, entity, x, y },
      );
    };
    api.closeMenu = () => setMenu(null);
    api.dragStart = (ev, ch) => {
      dragIdRef.current = ch.id;
      try {
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/nw-chapter', String(ch.id));
          ev.dataTransfer.setData('text/plain', String(ch.id));
        }
      } catch (err) {
        /* 某些实现禁止写 dataTransfer，dragIdRef 仍然是可靠来源 */
      }
      hideIndicator();
    };
    api.dragEnd = () => {
      dragIdRef.current = null;
      hideIndicator();
    };
    api.dragOver = (ev, ch) => {
      if (dragIdRef.current == null || sameId(dragIdRef.current, ch.id)) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      } catch (err) {
        /* 忽略 */
      }
      const rect = rectOf(ev.currentTarget);
      const before = readSide(rect, ev.clientY);
      hintRef.current = { id: ch.id, before };
      placeIndicator(rect, before);
    };
    api.drop = (ev, ch) => {
      const srcId = readDragSrc(ev, dragIdRef.current);
      if (srcId == null) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = rectOf(ev.currentTarget);
      const hint = hintRef.current;
      const before = hint && sameId(hint.id, ch.id) ? hint.before : readSide(rect, ev.clientY);
      dragIdRef.current = null;
      hideIndicator();
      applyMove(srcId, ch, before);
    };
    api.keyDown = (ev, ch, hasKids, collapsed) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        api.select(ch.id);
        return;
      }
      if (!hasKids) return;
      if (ev.key === 'ArrowRight' && collapsed) {
        ev.preventDefault();
        api.toggle(ch.id);
      } else if (ev.key === 'ArrowLeft' && !collapsed) {
        ev.preventDefault();
        api.toggle(ch.id);
      }
    };

    // -------------------------------------------------------- tree rows ----
    const buildTreeRows = (novelId) => {
      const out = [];
      const seen = new Set();
      const walk = (parentId, depth) => {
        const bucket = index.byParent.get(bucketKey(novelId, parentId));
        if (!bucket) return;
        for (let i = 0; i < bucket.length; i += 1) {
          const ch = bucket[i];
          if (ch.id == null || seen.has(String(ch.id))) continue;
          seen.add(String(ch.id));
          const kids = index.byParent.get(bucketKey(novelId, ch.id));
          const hasKids = !!(kids && kids.length > 0);
          const collapsed = collapsedIds.has(ch.id);
          out.push(
            h(ShelfRow, {
              key: String(ch.id),
              ch,
              depth,
              hasKids,
              collapsed,
              active: sameId(activeChapterId, ch.id),
              menuOpen: !!(menu && menu.kind === 'chapter' && sameId(menu.id, ch.id)),
              api,
            }),
          );
          if (hasKids && !collapsed) walk(ch.id, depth + 1);
        }
      };
      walk(null, 0);

      // 兜底：parentId 指向不存在节点的章节（数据损坏 / 同步冲突）若不可达，
      // 挂到根级末尾显示，避免它们从目录里彻底消失且无法被删除。
      // 注意判断必须用 index.reachable（只依赖 chapters），不能用上面的 seen ——
      // seen 受折叠状态影响，折叠一个卷会把它的子章误判成孤儿并重新挂回根级。
      const novelKey = String(novelId == null ? '' : novelId);
      const ofNovel = index.byNovel.get(novelKey) || EMPTY;
      const reachableSet = index.reachable.get(novelKey);
      let stray = null;
      for (let i = 0; i < ofNovel.length; i += 1) {
        const ch = ofNovel[i];
        if (!ch || ch.id == null) continue;
        if (reachableSet && reachableSet.has(String(ch.id))) continue;
        if (seen.has(String(ch.id))) continue;
        if (stray == null) stray = [];
        stray.push(ch);
      }
      if (stray) {
        stray.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        for (let i = 0; i < stray.length; i += 1) {
          const ch = stray[i];
          if (seen.has(String(ch.id))) continue;
          seen.add(String(ch.id));
          out.push(
            h(ShelfRow, {
              key: String(ch.id),
              ch,
              depth: 0,
              hasKids: false,
              collapsed: false,
              active: sameId(activeChapterId, ch.id),
              menuOpen: !!(menu && menu.kind === 'chapter' && sameId(menu.id, ch.id)),
              api,
            }),
          );
        }
      }
      return out;
    };

    // -------------------------------------------------------- fragments ----
    const searchInput = makeInput({
      value: rawQuery,
      onChange: (ev) => setRawQuery(readValue(ev)),
      placeholder: tr('搜索章节…'),
      'aria-label': tr('搜索章节…'),
    });

    const openChapter = (ch) => {
      if (ch.novelId != null && !sameId(ch.novelId, activeNovelId) && typeof P.onSelectNovel === 'function') {
        P.onSelectNovel(ch.novelId);
      }
      if (typeof P.onSelectChapter === 'function') P.onSelectChapter(ch.id);
      // 从搜索结果跳转后回到目录树，否则用户会一直停在结果视图里看不到上下文。
      setRawQuery('');
      setTerm('');
    };

    const novelCard = (n) => {
      const nid = String(n.id);
      const isActive = sameId(activeNovelId, n.id);
      const meta = [];
      if (n.updatedAt) meta.push(fmtDate(n.updatedAt));
      if (index.novelWords.has(nid)) meta.push(fmtWords(index.novelWords.get(nid)) + ' ' + tr('字'));
      const count = index.novelChapterCount.get(nid);
      if (count != null) meta.push(tr('{0} 章', count));
      const open = () => {
        if (typeof P.onSelectNovel === 'function') P.onSelectNovel(n.id);
      };
      return h(
        'div',
        {
          key: 'novel-' + nid,
          className: 'nw-shelf-novel' + (isActive ? ' is-active' : ''),
          'data-menu-open':
            menu && menu.kind === 'novel' && sameId(menu.id, n.id) ? '1' : '0',
          role: 'button',
          tabIndex: 0,
          'aria-pressed': isActive ? 'true' : 'false',
          title: n.title || tr('无标题'),
          onClick: open,
          onKeyDown: (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            open();
          },
        },
        h('span', { className: 'nw-shelf-cover', 'aria-hidden': 'true' }),
        h('div', { className: 'nw-shelf-novel-title' }, n.title || tr('无标题')),
        meta.length > 0
          ? h('div', { className: 'nw-shelf-novel-meta' }, meta.map((m, i) => h('span', { key: i }, m)))
          : null,
        h(
          'div',
          { className: 'nw-row-actions', onClick: (ev) => ev.stopPropagation() },
          makeIconBtn(icon('pencil'), tr('重命名'), () => {
            if (typeof P.onRename === 'function') P.onRename('novel', n.id, n.title || '');
          }),
          makeIconBtn(icon('trash'), tr('删除'), () => {
            if (typeof P.onDelete === 'function') P.onDelete('novel', n.id);
          }),
          makeIconBtn(icon('more', 15), tr('更多操作'), (ev) => api.openMenu(ev, 'novel', n)),
        ),
      );
    };

    const treeHead = (n, count, wordTotal) => {
      const bits = [tr('章节')];
      if (count != null) bits.push(tr('{0} 章', count));
      if (wordTotal != null) bits.push(fmtWords(wordTotal) + ' ' + tr('字'));
      return h('div', { key: 'treehead-' + String(n.id), className: 'nw-shelf-treehead' }, bits.join(' · '));
    };

    const rootDropEnd = (n) =>
      h('div', {
        key: 'dropend-' + String(n.id),
        className: 'nw-shelf-dropend',
        'aria-hidden': 'true',
        onDragOver: (ev) => {
          if (dragIdRef.current == null) return;
          ev.preventDefault();
          ev.stopPropagation();
          try {
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
          } catch (err) {
            /* 忽略 */
          }
          const rect = rectOf(ev.currentTarget);
          hintRef.current = { id: null, before: false };
          placeIndicator(rect, true);
        },
        onDrop: (ev) => {
          const srcId = readDragSrc(ev, dragIdRef.current);
          if (srcId == null) return;
          ev.preventDefault();
          ev.stopPropagation();
          dragIdRef.current = null;
          hideIndicator();
          appendToRoot(srcId);
        },
      });

    // ------------------------------------------------------------- body ----
    let body;

    if (novels.length === 0) {
      body = h(
        'div',
        { key: 'empty-shelf', className: 'nw-shelf-empty' },
        makeEmpty(tr('还没有小说')),
        h('p', { className: 'nw-shelf-empty-hint' }, tr('新建第一部小说，把灵感变成故事。')),
        makeBtn({
          kind: 'primary',
          title: tr('新建小说'),
          onClick: () => {
            if (typeof P.onCreateNovel === 'function') P.onCreateNovel();
          },
          children: tr('新建小说'),
        }),
      );
    } else if (search) {
      if (search.items.length === 0) {
        body = h(
          'div',
          { key: 'empty-search', className: 'nw-shelf-empty' },
          makeEmpty(tr('没有匹配的章节')),
          h('p', { className: 'nw-shelf-empty-hint' }, tr('试试更短的关键词，标题和正文都会匹配。')),
        );
      } else {
        body = h(
          'div',
          { key: 'searchlist', className: 'nw-shelf-results', role: 'list', 'aria-label': tr('搜索结果') },
          search.items.map((ch) => {
            const snippet = buildSnippet(ch.content, search.lower);
            const novelName = search.novelTitles.get(String(ch.novelId == null ? '' : ch.novelId));
            return h(
              'div',
              {
                key: 'hit-' + String(ch.id),
                className: 'nw-shelf-result',
                role: 'listitem',
                tabIndex: 0,
                title: ch.title || tr('未命名章节'),
                onClick: () => openChapter(ch),
                onKeyDown: (ev) => {
                  if (ev.key !== 'Enter') return;
                  ev.preventDefault();
                  openChapter(ch);
                },
              },
              h('div', { className: 'nw-shelf-result-title' }, highlightText(ch.title || tr('未命名章节'), search.lower)),
              novelName ? h('div', { className: 'nw-shelf-result-sub' }, novelName) : null,
              snippet
                ? h(
                    'div',
                    { className: 'nw-shelf-result-snippet' },
                    snippet.prefix,
                    h('mark', { className: 'nw-shelf-hit' }, snippet.hit),
                    snippet.suffix,
                  )
                : null,
            );
          }),
        );
      }
    } else {
      const parts = [];
      let sawActive = false;
      for (let i = 0; i < novels.length; i += 1) {
        const n = novels[i];
        if (!n || n.id == null) continue;
        parts.push(novelCard(n));
        if (!sameId(activeNovelId, n.id)) continue;
        sawActive = true;
        const nid = String(n.id);
        parts.push(treeHead(n, index.novelChapterCount.get(nid), index.novelWords.get(nid)));
        const rows = buildTreeRows(n.id);
        if (rows.length === 0) {
          parts.push(
            h('div', { key: 'emptytree-' + nid, className: 'nw-shelf-hint' }, tr('这部小说还没有章节，点页脚的 新建章节 开始。')),
          );
        } else {
          parts.push(
            h('div', { key: 'tree-' + nid, role: 'tree', 'aria-label': tr('章节'), className: 'nw-shelf-tree' }, rows),
          );
        }
        parts.push(rootDropEnd(n));
      }
      if (!sawActive) {
        parts.push(h('div', { key: 'noactive', className: 'nw-shelf-hint' }, tr('从上方选择一部小说查看目录。')));
      }
      body = parts;
    }

    const openTrash = () => {
      if (typeof P.onOpenTrash === 'function') {
        P.onOpenTrash();
        return;
      }
      toast(tr('回收站入口尚未接入'));
    };

    /** 新入口在 lead 的 90-app 里接入；缺失时给一条提示而不是静默无反应。 */
    const callOrHint = (fn, hint) => {
      if (typeof fn === 'function') {
        fn();
        return;
      }
      toast(hint);
    };
    const importNovel = () => callOrHint(P.onImport, tr('导入入口尚未接入'));
    const collapseShelf = () => callOrHint(P.onCollapse, tr('收起侧栏尚未接入'));

    // 「⋯」小菜单：导出 / 重命名 / 删除。role=menu + role=menuitem，
    // Escape 与外部点击由上面的 document 监听负责关闭。
    const menuItem = (name, label, onClick, danger) =>
      h(
        'button',
        {
          key: name,
          type: 'button',
          className: 'nw-shelf-menu-item' + (danger ? ' is-danger' : ''),
          role: 'menuitem',
          onClick: (ev) => {
            ev.stopPropagation();
            setMenu(null);
            onClick();
          },
        },
        icon(name, 15),
        h('span', { className: 'nw-shelf-menu-label' }, label),
      );

    const renderMenu = () => {
      if (!menu) return null;
      const entity = menu.entity || {};
      const title =
        entity.title || (menu.kind === 'novel' ? tr('无标题') : tr('未命名章节'));
      return h(
        'div',
        {
          ref: menuRef,
          className: 'nw-shelf-menu nw-fade-up',
          role: 'menu',
          'aria-label': title,
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onClick: (ev) => ev.stopPropagation(),
        },
        menuItem(
          'download',
          tr('导出'),
          () => {
            if (typeof P.onExport === 'function') P.onExport(menu.kind, menu.id);
            else toast(tr('导出入口尚未接入'));
          },
          false,
        ),
        menuItem(
          'pencil',
          tr('重命名'),
          () => {
            if (typeof P.onRename === 'function') P.onRename(menu.kind, menu.id, title);
          },
          false,
        ),
        menuItem(
          'trash',
          tr('删除'),
          () => {
            if (typeof P.onDelete === 'function') P.onDelete(menu.kind, menu.id);
          },
          true,
        ),
      );
    };

    return h(
      'aside',
      {
        ref: shelfRef,
        className: 'nw-shelf',
        'aria-label': tr('小说目录'),
        'data-collapsed': P.collapsed ? '1' : '0',
      },
      h(
        'div',
        { className: 'nw-shelf-top' },
        h(
          'div',
          { className: 'nw-shelf-topbar' },
          h('span', { className: 'nw-shelf-toplabel' }, tr('书架')),
          // R5 moved the whole top strip in here: the plugin no longer renders
          // a toolbar above the writing column, so 首页 / 沉浸 / 宿主侧栏 / 锁定 /
          // 设置 all live one click away from the shelf header.
          h(
            'div',
            { className: 'nw-shelf-topacts', role: 'toolbar', 'aria-label': tr('侧栏操作') },
            makeIconBtn(icon('home', 15), tr('创作台首页'), () => {
              if (typeof P.onHome === 'function') P.onHome();
            }),
            makeIconBtn(icon('immersive', 15), tr('沉浸模式'), () => {
              if (typeof P.onImmersive === 'function') P.onImmersive();
            }),
            makeIconBtn(icon('panel', 15), tr('收起/展开宿主侧栏'), () => {
              if (typeof P.onToggleHostSidebar === 'function') P.onToggleHostSidebar();
            }),
            makeIconBtn(icon('lock', 15), tr('锁定'), () => {
              if (typeof P.onLock === 'function') P.onLock();
            }),
            makeIconBtn(icon('gear', 15), tr('设置'), () => {
              if (typeof P.onOpenSettings === 'function') P.onOpenSettings();
            }),
            makeIconBtn(icon('chevleft', 15), tr('收起侧栏'), collapseShelf),
          ),
        ),
        h(
          'div',
          { className: 'nw-shelf-searchbar' },
          h('div', { className: 'nw-shelf-searchwrap' }, searchInput),
          rawQuery ? makeIconBtn(icon('x', 15), tr('清除'), () => setRawQuery('')) : null,
        ),
      ),
      h(
        'div',
        {
          ref: scrollRef,
          className: 'nw-shelf-scroll',
          onDragLeave: (ev) => {
            const next = ev.relatedTarget;
            if (next && ev.currentTarget && ev.currentTarget.contains(next)) return;
            hideIndicator();
          },
          onDragEnd: () => hideIndicator(),
          onDrop: () => hideIndicator(),
        },
        body,
        h('div', { ref: indicatorRef, className: 'nw-shelf-indicator', 'aria-hidden': 'true' }),
      ),
      renderMenu(),
      h(
        'div',
        { className: 'nw-shelf-foot' },
        h(
          'div',
          { className: 'nw-shelf-footbar', role: 'toolbar', 'aria-label': tr('目录操作') },
          makeIconBtn(icon('book', 18), tr('新建小说'), () => {
            if (typeof P.onCreateNovel === 'function') P.onCreateNovel();
          }),
          makeIconBtn(icon('plus', 18), tr('新建章节'), () => {
            if (typeof P.onCreateChapter === 'function') P.onCreateChapter(null);
          }),
          makeIconBtn(icon('upload', 18), tr('导入'), importNovel),
          makeIconBtn(icon('trash', 18), tr('回收站'), openTrash),
          makeIconBtn(icon('gear', 18), tr('设置'), () => {
            if (typeof P.onOpenSettings === 'function') P.onOpenSettings();
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'nw-shelf-import',
            title: tr('导入小说'),
            'aria-label': tr('导入小说'),
            onClick: importNovel,
          },
          icon('upload', 18),
          h('span', { className: 'nw-shelf-import-label' }, tr('导入小说')),
        ),
      ),
    );
  };

  // ------------------------------------------------------------------ css ---
  NW.CSS_PARTS.push(`
/* ============================================================ shelf root ==
   The shelf is host chrome, but R3 moved every shared scale into the tokens
   published by 05-css.js (which themselves resolve onto the --dsw-alias-*
   aliases), so this part only ever names a token — never a literal colour.
   Scale: 16px base / 14px secondary / 13px micro, radius 12 card / 10
   control, rhythm 8 / 10 / 12 / 16. */
.nw-shelf{
  position:relative;
  display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;
  background:var(--dsw-specific-sidebar-fill, var(--nw-surface-1));
  color:var(--nw-fg);
  font-family:var(--nw-ui-font);
  font-size:var(--nw-fs-base);line-height:var(--nw-lh-base);
  -webkit-font-smoothing:antialiased;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease),
    transform var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf *{box-sizing:border-box;}
/* 90-app 收起侧栏时整列不渲染；data-collapsed 只负责离场姿态的过渡。 */
.nw-shelf[data-collapsed="1"]{opacity:0;transform:translateX(-12px);pointer-events:none;}

/* ------------------------------------------------------------ 顶部区 ---- */
.nw-shelf-top{
  flex:0 0 auto;display:flex;flex-direction:column;gap:var(--nw-sp-2);
  padding:var(--nw-sp-3) var(--nw-sp-3) var(--nw-sp-2);
}
.nw-shelf-topbar{
  display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-1);
  min-height:32px;
}
.nw-shelf-toplabel{
  min-width:0;
  font-size:var(--nw-fs-micro);font-weight:600;line-height:1.2;
  letter-spacing:.06em;color:var(--nw-fg-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-shelf-topbar .nw-btn[data-kind="icon"],
.nw-shelf-topbar .nw-shelf-iconbtn{
  flex:0 0 auto;width:32px;height:32px;padding:0;
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
/* Six 32px buttons do not fit next to the label at the 220px minimum width, so
   the action cluster tightens to 24px targets and the label yields first. */
.nw-shelf-topacts{display:flex;align-items:center;gap:1px;flex:0 0 auto;min-width:0;}
.nw-shelf-topacts .nw-btn[data-kind="icon"],
.nw-shelf-topacts .nw-shelf-iconbtn{
  width:24px;height:24px;border-radius:8px;
}
.nw-shelf-topacts .nw-shelf-iconbtn > svg,
.nw-shelf-topacts .nw-btn[data-kind="icon"] > span > svg{display:block;}

.nw-shelf-topbar .nw-btn[data-kind="icon"]:hover:not(:disabled),
.nw-shelf-topbar .nw-shelf-iconbtn:hover{
  background:var(--nw-surface-2);color:var(--nw-fg);
  transform:none;box-shadow:none;
}

/* ---------------------------------------------------------- 搜索框 ---- */
.nw-shelf-searchbar{display:flex;align-items:center;gap:var(--nw-sp-1);}
.nw-shelf-searchwrap{flex:1 1 auto;min-width:0;display:flex;align-items:center;}
.nw-shelf-searchwrap > *{width:100%;min-width:0;}
.nw-shelf-searchbar > *:not(.nw-shelf-searchwrap){flex:0 0 auto;}
.nw-shelf .nw-input,
.nw-shelf-input{
  width:100%;min-width:0;height:var(--nw-h-input);padding:0 var(--nw-sp-3);
  border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:inherit;font-size:var(--nw-fs-base);line-height:1.4;outline:none;
  transition:border-color var(--nw-dur,.18s) var(--nw-ease,ease),
    box-shadow var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf .nw-input::placeholder,
.nw-shelf-input::placeholder{color:var(--nw-fg-soft);opacity:.72;}
.nw-shelf .nw-input:hover:not(:disabled),
.nw-shelf-input:hover{border-color:var(--nw-line);}
.nw-shelf .nw-input:focus,
.nw-shelf-input:focus{border-color:var(--nw-brand);box-shadow:var(--nw-ring-soft);}
.nw-shelf-searchbar > .nw-btn[data-kind="icon"],
.nw-shelf-searchbar > .nw-shelf-iconbtn{
  flex:0 0 auto;width:32px;height:32px;padding:0;
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-searchbar > .nw-btn[data-kind="icon"]:hover:not(:disabled),
.nw-shelf-searchbar > .nw-shelf-iconbtn:hover{
  background:var(--nw-surface-2);color:var(--nw-fg);
  transform:none;box-shadow:none;
}

/* -------------------------------------------------------- 滚动区域 ---- */
.nw-shelf-scroll{
  position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;
  padding:var(--nw-sp-1) 0 var(--nw-sp-3);scrollbar-width:thin;
}
.nw-shelf-scroll::-webkit-scrollbar{width:10px;}
.nw-shelf-scroll::-webkit-scrollbar-thumb{
  background:var(--nw-line);background-clip:padding-box;
  border:2px solid transparent;border-radius:var(--nw-r-pill);
}
.nw-shelf-scroll::-webkit-scrollbar-track{background:transparent;}
/* 拖拽插入指示线：2px 品牌色 + 一点光晕，位置由 JS 写 inline top/opacity。 */
.nw-shelf-indicator{
  position:absolute;z-index:4;left:var(--nw-sp-2);right:var(--nw-sp-2);top:0;height:2px;
  border-radius:2px;opacity:0;pointer-events:none;
  background:var(--nw-brand);
  box-shadow:0 0 8px color-mix(in srgb, var(--nw-brand) 55%, transparent);
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}

/* ------------------------------------------------------ 小说卡片 ---- */
.nw-shelf-novel{
  position:relative;display:grid;
  grid-template-columns:34px minmax(0,1fr);
  grid-template-rows:auto auto;
  column-gap:var(--nw-sp-3);row-gap:3px;align-items:center;
  margin:0 var(--nw-sp-2) 6px;padding:var(--nw-sp-3);
  border:1px solid transparent;border-radius:var(--nw-r-card);
  cursor:pointer;outline:none;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    border-color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-novel:hover{background:var(--nw-surface-2);}
.nw-shelf-novel:focus-visible{outline:2px solid var(--nw-brand);outline-offset:-2px;}
/* 选中态：底色淡染 + 左侧 3px 品牌条。用绝对定位伪元素而不是 inset 阴影，
   因为圆角存在时 inset 阴影会沿圆角弯成括号形。 */
.nw-shelf-novel.is-active{
  background:var(--nw-surface-2);
  border-color:color-mix(in srgb, var(--nw-brand) 16%, transparent);
}
.nw-shelf-novel::after{
  content:'';position:absolute;left:0;top:var(--nw-sp-3);bottom:var(--nw-sp-3);width:3px;
  border-radius:2px;background:var(--nw-brand);opacity:0;pointer-events:none;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-novel.is-active::after{opacity:1;}
/* 纯 CSS 封面：品牌色线性渐变 + 一道中性书脊，不用图片。 */
.nw-shelf-cover{
  position:relative;grid-column:1;grid-row:1 / span 2;
  width:34px;height:34px;border-radius:8px;
  background-image:linear-gradient(135deg,
    var(--nw-brand) 0%,
    color-mix(in srgb, var(--nw-brand) 62%, var(--nw-bg)) 100%);
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--nw-bg) 24%, transparent);
}
.nw-shelf-cover::after{
  content:'';position:absolute;left:8px;top:9px;bottom:9px;width:2px;
  border-radius:2px;background:color-mix(in srgb, var(--nw-bg) 55%, transparent);
}
.nw-shelf-novel-title{
  grid-column:2;grid-row:1;min-width:0;
  font-size:var(--nw-fs-base);font-weight:600;line-height:1.35;letter-spacing:.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:padding-right var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-novel-meta{
  grid-column:2;grid-row:2;min-width:0;
  display:flex;flex-wrap:wrap;align-items:center;gap:var(--nw-sp-1);
  font-size:var(--nw-fs-micro);line-height:1.4;color:var(--nw-fg-soft);
  font-variant-numeric:tabular-nums;
}

/* ------------------------------------------------------ 章节树 ---- */
.nw-shelf-tree{padding:2px 0;}
.nw-shelf-treehead{
  display:flex;align-items:center;gap:var(--nw-sp-2);
  margin:var(--nw-sp-3) var(--nw-sp-3) 6px;padding:0;
  font-size:var(--nw-fs-second);line-height:1.5;font-weight:600;
  letter-spacing:.02em;color:var(--nw-fg-soft);font-variant-numeric:tabular-nums;
}
.nw-shelf-treehead::after{content:'';flex:1 1 auto;height:1px;background:var(--nw-line-soft);}
.nw-shelf-row{
  position:relative;display:flex;align-items:center;gap:var(--nw-sp-1);
  height:36px;margin:1px var(--nw-sp-2);padding:0 var(--nw-sp-2) 0 6px;
  border-radius:var(--nw-r-control);
  font-size:var(--nw-fs-base);line-height:1.4;color:var(--nw-fg);
  cursor:pointer;outline:none;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-row:hover{background:var(--nw-surface-2);}
.nw-shelf-row:focus-visible{outline:2px solid var(--nw-brand);outline-offset:-2px;}
.nw-shelf-row.is-active{background:var(--nw-surface-2);color:var(--nw-fg);font-weight:500;}
.nw-shelf-row.is-active::after{
  content:'';position:absolute;left:2px;top:7px;bottom:7px;width:3px;
  border-radius:2px;background:var(--nw-brand);
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}
/* 层级连接线：行上 aria-level = 深度 + 1，每级缩进 14px，
   所以线要落在祖先 caret 的中线（行内 left 16px 起，每级 +14px）。 */
.nw-shelf-row::before{
  content:'';position:absolute;top:-1px;bottom:-1px;left:16px;width:1px;
  background:transparent;pointer-events:none;
}
.nw-shelf-row[aria-level="2"]::before{width:1px;background:var(--nw-line-soft);}
.nw-shelf-row[aria-level="3"]::before{width:15px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="4"]::before{width:29px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="5"]::before{width:43px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="6"]::before{width:57px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="7"]::before{width:71px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="8"]::before{width:85px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-row[aria-level="9"]::before{width:99px;background:repeating-linear-gradient(90deg,var(--nw-line-soft) 0,var(--nw-line-soft) 1px,transparent 1px,transparent 14px);}
.nw-shelf-caret{
  flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  width:20px;height:20px;border-radius:6px;color:var(--nw-fg-soft);cursor:pointer;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-caret svg{
  width:15px;height:15px;transform:rotate(90deg);
  transition:transform var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-caret[data-open="0"] svg{transform:rotate(0deg);}
.nw-shelf-caret:hover{background:var(--nw-surface-2);color:var(--nw-fg);}
.nw-shelf-caret.is-empty{visibility:hidden;cursor:default;}
.nw-shelf-row-title{
  flex:1 1 auto;min-width:0;font-size:inherit;line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-shelf-row-meta{
  flex:0 0 auto;font-size:var(--nw-fs-micro);line-height:1.4;color:var(--nw-fg-soft);
  font-variant-numeric:tabular-nums;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}
/* 悬停时动作条浮在行右侧，字数先淡出让位，避免被按钮压住。 */
.nw-shelf-row:hover .nw-shelf-row-meta{opacity:0;}

/* --------------------------------------------- 行内动作按钮（悬停显示） ---- */
.nw-row-actions{
  position:absolute;z-index:2;top:50%;right:var(--nw-sp-1);transform:translateY(-50%);
  display:flex;align-items:center;gap:1px;padding:2px;
  border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-shadow-1);
}
/* 97-theme 给 .nw-row-actions .nw-btn 定的 32px 高在这里压回紧凑尺寸（0,4,0）。 */
.nw-shelf .nw-row-actions .nw-btn[data-kind="icon"]{
  width:26px;height:26px;padding:0;border:0;border-radius:8px;
  background:transparent;color:var(--nw-fg-soft);
}
.nw-shelf .nw-row-actions .nw-btn[data-kind="icon"]:hover:not(:disabled){
  background:var(--nw-surface-2);color:var(--nw-fg);
  transform:none;box-shadow:none;
}
/* NW.ui 缺失时的回退按钮（.nw-shelf-iconbtn）同样压到 26×26。 */
.nw-shelf .nw-row-actions .nw-shelf-iconbtn{
  width:26px;height:26px;padding:0;border:0;border-radius:8px;
  background:transparent;color:var(--nw-fg-soft);
}
.nw-shelf .nw-row-actions .nw-shelf-iconbtn:hover{
  background:var(--nw-surface-2);color:var(--nw-fg);
}
.nw-shelf-novel .nw-row-actions{
  top:var(--nw-sp-1);right:var(--nw-sp-1);transform:none;
  opacity:0;pointer-events:none;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}
/* 菜单打开时即使指针移开也要保住动作条，否则「⋯」锚点会被卸载。 */
.nw-shelf-novel:hover .nw-row-actions,
.nw-shelf-novel:focus-within .nw-row-actions,
.nw-shelf-novel[data-menu-open="1"] .nw-row-actions{opacity:1;pointer-events:auto;}
.nw-shelf-novel:hover .nw-shelf-novel-title,
.nw-shelf-novel:focus-within .nw-shelf-novel-title,
.nw-shelf-novel[data-menu-open="1"] .nw-shelf-novel-title{padding-right:96px;}

/* --------------------------------------------------- 「⋯」动作菜单 ---- */
/* 绝对定位在 .nw-shelf 内（侧栏 overflow:hidden 会裁切，所以 JS 已把
   锚点换算成侧栏内坐标并按侧栏尺寸夹取/上翻）。 */
/* 宽度固定 184px（border-box），与 api.openMenu 里的夹取常量一致，
   保证贴着侧栏右缘时不会被 .nw-shelf 的 overflow:hidden 裁掉。 */
.nw-shelf-menu{
  position:absolute;z-index:20;width:184px;padding:6px;
  display:flex;flex-direction:column;gap:2px;
  border:1px solid var(--nw-line);border-radius:var(--nw-r-card);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-shadow-3);
  transform-origin:top right;
}
.nw-shelf-menu-item{
  display:flex;align-items:center;gap:var(--nw-sp-2);
  width:100%;height:36px;padding:0 var(--nw-sp-2);margin:0;
  border:0;border-radius:var(--nw-r-control);background:transparent;color:var(--nw-fg);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-second);font-weight:500;
  line-height:1;text-align:left;cursor:pointer;appearance:none;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-menu-item:hover{background:var(--nw-surface-2);}
.nw-shelf-menu-item:focus-visible{outline:2px solid var(--nw-brand);outline-offset:-2px;}
.nw-shelf-menu-item.is-danger{color:var(--nw-danger);}
.nw-shelf-menu-item.is-danger:hover{
  background:color-mix(in srgb, var(--nw-danger) 12%, transparent);
  color:var(--nw-danger);
}
.nw-shelf-menu-label{
  flex:1 1 auto;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}

/* -------------------------------------------------------- 搜索结果 ---- */
.nw-shelf-results{display:flex;flex-direction:column;padding:2px 0;}
.nw-shelf-result{
  position:relative;margin:1px var(--nw-sp-2);padding:var(--nw-sp-2) var(--nw-sp-3);
  border-radius:var(--nw-r-control);cursor:pointer;outline:none;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-result:hover{background:var(--nw-surface-2);}
.nw-shelf-result:focus-visible{outline:2px solid var(--nw-brand);outline-offset:-2px;}
.nw-shelf-result-title{
  font-size:var(--nw-fs-base);font-weight:600;line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-shelf-result-sub{
  font-size:var(--nw-fs-micro);line-height:1.4;color:var(--nw-fg-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-shelf-result-snippet{
  margin-top:5px;font-size:var(--nw-fs-second);line-height:1.6;color:var(--nw-fg-soft);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  word-break:break-word;
}
.nw-shelf-hit{
  border-radius:3px;padding:0 2px;font-weight:700;text-decoration:none;
  background:color-mix(in srgb, var(--nw-brand) 16%, transparent);
  color:var(--nw-brand);
}
.nw-shelf-dropend{position:relative;height:16px;margin:2px var(--nw-sp-2) var(--nw-sp-1);border-radius:6px;}

/* -------------------------------------------------------- 页脚工具栏 ---- */
.nw-shelf-foot{
  flex:0 0 auto;display:flex;flex-direction:column;gap:var(--nw-sp-1);
  padding:var(--nw-sp-2) var(--nw-sp-3) var(--nw-sp-3);
  border-top:1px solid var(--nw-line-soft);
}
/* 五个功能键等宽铺满，≥40×40（契约 §5）。 */
.nw-shelf-footbar{display:flex;align-items:center;gap:4px;}
.nw-shelf-foot .nw-btn[data-kind="icon"],
.nw-shelf-foot .nw-shelf-iconbtn{
  flex:1 1 0;min-width:40px;width:auto;height:40px;padding:0;
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease),
    transform var(--nw-dur,.18s) var(--nw-ease,ease),
    box-shadow var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-foot .nw-btn[data-kind="icon"]:hover:not(:disabled),
.nw-shelf-foot .nw-shelf-iconbtn:hover{
  background:var(--nw-surface-2);color:var(--nw-fg);
  transform:translateY(-1px);box-shadow:var(--nw-shadow-1);
}
/* 左下「导入小说」大按钮：图标 + 文案，整宽、40px 高。 */
.nw-shelf-import{
  display:flex;align-items:center;justify-content:center;gap:var(--nw-sp-1);
  width:100%;height:40px;padding:0 var(--nw-sp-3);margin:0;
  border:1px solid var(--nw-line);border-radius:var(--nw-r-control);
  background:var(--nw-surface-2);color:var(--nw-fg);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-second);font-weight:600;
  line-height:1;cursor:pointer;appearance:none;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    border-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease),
    transform var(--nw-dur,.18s) var(--nw-ease,ease),
    box-shadow var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-import:hover{
  background:var(--nw-surface-overlay);border-color:var(--nw-line-strong);
  transform:translateY(-1px);box-shadow:var(--nw-shadow-1);
}
.nw-shelf-import:active{transform:none;box-shadow:none;}
.nw-shelf-import:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-shelf-import-label{
  min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}

/* ------------------------------------------------------------ 空态 ---- */
.nw-shelf-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--nw-sp-3);padding:40px var(--nw-sp-5) var(--nw-sp-6);text-align:center;
}
/* 空态插图：纯 CSS 画的一排书脊 + 底板，不用图片，也不写 token 之外的颜色。 */
.nw-shelf-empty::before{
  content:'';flex:0 0 auto;width:64px;height:56px;background-repeat:no-repeat;
  background-image:
    linear-gradient(var(--nw-line-soft), var(--nw-line-soft)),
    linear-gradient(180deg,
      color-mix(in srgb, var(--nw-brand) 74%, var(--nw-bg)),
      color-mix(in srgb, var(--nw-brand) 46%, var(--nw-bg))),
    linear-gradient(180deg,
      color-mix(in srgb, var(--nw-brand) 34%, var(--nw-bg)),
      color-mix(in srgb, var(--nw-brand) 18%, var(--nw-bg))),
    linear-gradient(180deg,
      color-mix(in srgb, var(--nw-brand) 62%, var(--nw-bg)),
      color-mix(in srgb, var(--nw-brand) 30%, var(--nw-bg)));
  background-size:50px 2px,13px 31px,10px 23px,14px 37px;
  background-position:7px 46px,9px 15px,23px 23px,37px 9px;
}
/* NW.ui.empty 自带 34×34 的通用图标，这里换成上面的书脊插图。 */
.nw-shelf-empty .nw-empty{
  padding:0;height:auto;gap:0;
  font-size:var(--nw-fs-base);line-height:var(--nw-lh-base);color:var(--nw-fg-soft);
}
.nw-shelf-empty .nw-empty svg{display:none;}
.nw-shelf-empty-hint{
  margin:0;max-width:240px;
  font-size:var(--nw-fs-second);line-height:1.6;color:var(--nw-fg-soft);
}
.nw-shelf-empty-text{margin:0;font-size:var(--nw-fs-base);color:var(--nw-fg-soft);}
.nw-shelf-empty .nw-btn[data-kind="primary"]{
  height:var(--nw-h-btn);margin-top:2px;padding:0 var(--nw-sp-4);
  border-radius:var(--nw-r-control);font-size:var(--nw-fs-second);
}
.nw-shelf-hint{
  margin:var(--nw-sp-2) var(--nw-sp-3);
  font-size:var(--nw-fs-second);line-height:1.6;color:var(--nw-fg-soft);
}

/* ------------------------------------------- NW.ui 缺失时的回退控件 ---- */
.nw-shelf-btn-fallback{
  display:inline-flex;align-items:center;justify-content:center;gap:var(--nw-sp-1);
  height:var(--nw-h-btn);padding:0 var(--nw-sp-3);border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line-soft);background:transparent;
  color:var(--nw-fg);font-family:var(--nw-ui-font);font-size:var(--nw-fs-second);
  cursor:pointer;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    border-color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-btn-fallback:hover{background:var(--nw-surface-2);border-color:var(--nw-line);}
.nw-shelf-btn-fallback.is-primary{
  background:var(--nw-brand);border-color:var(--nw-brand);color:var(--nw-bg);
}
.nw-shelf-iconbtn{
  display:inline-flex;align-items:center;justify-content:center;
  width:var(--nw-h-iconbtn);height:var(--nw-h-iconbtn);padding:0;
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);cursor:pointer;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelf-iconbtn:hover{background:var(--nw-surface-2);color:var(--nw-fg);}

/* ------------------------------------------------------------ 动效 ---- */
@media (prefers-reduced-motion: reduce){
  .nw-shelf,
  .nw-shelf *,
  .nw-shelf *::before,
  .nw-shelf *::after{
    animation-duration:.001ms !important;
    animation-iteration-count:1 !important;
    transition-duration:.001ms !important;
  }
  .nw-shelf-import:hover,
  .nw-shelf-foot .nw-btn[data-kind="icon"]:hover:not(:disabled){
    transform:none !important;
    box-shadow:none !important;
  }
}
`);
})();
