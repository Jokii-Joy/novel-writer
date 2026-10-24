;(() => {
  'use strict';

  // ============================================================ Welcome ======
  //
  // The plugin's default screen. Before R5 the main area opened straight into
  // the last chapter, which meant the first thing a new user saw was either an
  // empty editor or somebody else's half-written paragraph. The home screen
  // answers the four questions a writer actually has on open:
  //
  //   1. what am I working on      → 正在创作 (novel cards, newest first)
  //   2. how much have I written   → 创作统计 (book / novel / 7-day / today)
  //   3. where did I submit        → 投稿记录 (status badge + days since)
  //   4. what do I want to do now  → 快捷入口 (continue / new / import / submit)
  //
  // Props are all optional — a missing list renders an empty state rather than
  // throwing, because this component also runs during the very first boot when
  // IndexedDB has nothing in it yet.
  // ===========================================================================

  const STATUS_META = {
    sent: { label: '已投稿', tone: 'idle' },
    pending: { label: '等待回复', tone: 'info' },
    accepted: { label: '已过稿', tone: 'ok' },
    rejected: { label: '已退稿', tone: 'danger' },
    published: { label: '已发表', tone: 'brand' },
    withdrawn: { label: '已撤回', tone: 'idle' },
  };

  function tr(key) {
    return typeof NW.t === 'function' ? NW.t(key) : key;
  }

  function fmtWords(value) {
    const n = Number(value) || 0;
    if (typeof NW.fmtWords === 'function') return NW.fmtWords(n);
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + ' 万';
    return String(n);
  }

  function dayStamp(value) {
    const n = Number(value) || 0;
    if (!n) return '';
    try {
      return NW.fmtDate ? NW.fmtDate(n) : new Date(n).toLocaleDateString('zh-CN');
    } catch (err) {
      return '';
    }
  }

  function shortDate(value) {
    const n = Number(value) || 0;
    if (!n) return '—';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function statusOf(row) {
    const key = String((row && row.status) || 'sent');
    return STATUS_META[key] || STATUS_META.sent;
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Aggregate the numbers the stats card shows from the live chapter list. */
  function computeStats(chapters, activeNovelId) {
    const rows = Array.isArray(chapters) ? chapters : [];
    const today = startOfToday();
    const weekAgo = today - 6 * 24 * 60 * 60 * 1000;
    let total = 0;
    let novel = 0;
    let todayWords = 0;
    let weekWords = 0;
    let count = 0;
    let touched = 0;

    for (const row of rows) {
      if (!row) continue;
      count += 1;
      const words = Number(row.wordCount) || 0;
      total += words;
      if (activeNovelId != null && String(row.novelId) === String(activeNovelId)) novel += words;
      const at = Number(row.updatedAt) || 0;
      if (at >= today) todayWords += words;
      else if (at >= weekAgo) weekWords += words;
      if (at > touched) touched = at;
    }

    return { total, novel, todayWords, weekWords, count, touched };
  }

  /** Per-novel rollup so each card can show chapters + words + last touched. */
  function rollupNovels(novels, chapters) {
    const list = Array.isArray(novels) ? novels.filter(Boolean) : [];
    const rows = Array.isArray(chapters) ? chapters : [];
    const byNovel = new Map();
    for (const row of rows) {
      if (!row) continue;
      const key = String(row.novelId);
      const cell = byNovel.get(key) || { chapters: 0, words: 0, touched: 0 };
      cell.chapters += 1;
      cell.words += Number(row.wordCount) || 0;
      const at = Number(row.updatedAt) || 0;
      if (at > cell.touched) cell.touched = at;
      byNovel.set(key, cell);
    }
    return list
      .map((novel) => {
        const cell = byNovel.get(String(novel.id)) || { chapters: 0, words: 0, touched: 0 };
        return {
          novel,
          chapters: cell.chapters,
          words: cell.words,
          touched: cell.touched || Number(novel.updatedAt) || 0,
        };
      })
      .sort((a, b) => b.touched - a.touched);
  }

  /**
   * `extra` renders on the same baseline as the title, right-aligned. The inbox
   * refresh link used to be its own row above the list, which cost a line of
   * height and read as a stray button rather than a property of the card.
   */
  function card(titleText, children, tone, extra) {
    const title = NW.h('h2', { className: 'nw-welcome-cardtitle' }, titleText);
    return NW.h(
      'section',
      { className: 'nw-welcome-card' + (tone ? ' nw-welcome-card-' + tone : '') },
      extra
        ? NW.h('div', { className: 'nw-welcome-cardhead' }, title, NW.h('div', { className: 'nw-welcome-cardact' }, extra))
        : title,
      children,
    );
  }

  function emptyLine(text) {
    return NW.h('p', { className: 'nw-welcome-empty' }, text);
  }

  /**
   * R16 ⑤: every home card shows at most three rows. The rest stay one click
   * away instead of pushing the page down — a writer opening the plugin wants
   * "what was I doing", not a scrollable archive.
   */
  const HOME_LIMIT = 3;

  function foldRows(items, expanded) {
    const all = Array.isArray(items) ? items : [];
    if (expanded || all.length <= HOME_LIMIT) return { visible: all, hidden: 0 };
    return { visible: all.slice(0, HOME_LIMIT), hidden: all.length - HOME_LIMIT };
  }

  function moreRow(hidden, expanded, onToggle) {
    if (hidden <= 0 && !expanded) return null;
    return NW.h(
      'button',
      {
        type: 'button',
        className: 'nw-welcome-more',
        onClick: onToggle,
        'aria-expanded': expanded ? 'true' : 'false',
      },
      expanded ? '收起' : `展开全部 ${hidden} 条`,
      NW.h(
        'span',
        { className: 'nw-welcome-moreico', 'aria-hidden': 'true' },
        NW.icon(expanded ? 'chevup' : 'chevdown', { size: 14 }),
      ),
    );
  }

  function Welcome(props) {
    const p = props || {};
    const novels = Array.isArray(p.novels) ? p.novels.filter(Boolean) : [];
    const chapters = Array.isArray(p.chapters) ? p.chapters : [];
    const submissions = Array.isArray(p.submissions) ? p.submissions : [];
    const stats = computeStats(chapters, p.activeNovelId);
    const rollups = rollupNovels(novels, chapters);
    const journalCount = Number(p.journalCount) || 0;
    // R16 ⑤: each card folds to three rows and remembers its own state.
    const [novelOpen, setNovelOpen] = NW.React.useState(false);
    const [subsOpen, setSubsOpen] = NW.React.useState(false);
    const [inboxOpen, setInboxOpen] = NW.React.useState(false);

    // NW.ui.btn renders `children` verbatim, so the icon is prepended as a
    // keyed sibling span rather than passed as a separate prop.
    const btn = (label, onClick, kind, iconName, disabled) =>
      NW.ui.btn({
        kind: kind || 'ghost',
        onClick: onClick,
        disabled: !!disabled,
        children: iconName
          ? [
              NW.h('span', { key: 'i', className: 'nw-btn-icon', 'aria-hidden': 'true' }, NW.icon(iconName, { size: 16 })),
              NW.h('span', { key: 't' }, label),
            ]
          : label,
      });

    const header = NW.h(
      'header',
      { className: 'nw-welcome-head' },
      NW.h(
        'div',
        { className: 'nw-welcome-headtext' },
        NW.h('h1', { className: 'nw-welcome-title' }, tr('精神空间')),
        NW.h(
          'p',
          { className: 'nw-welcome-lead' },
          novels.length === 0
            ? '还没有小说。新建一部，或者把已有的 txt / md / docx / epub 导入进来。'
            : `共 ${novels.length} 部作品、${stats.count} 个章节、${fmtWords(stats.total)} 字。`,
        ),
      ),
      NW.h(
        'div',
        { className: 'nw-welcome-actions' },
        btn(tr('新建小说'), () => typeof p.onNewNovel === 'function' && p.onNewNovel(), 'primary', 'plus'),
        btn(tr('导入'), () => typeof p.onImport === 'function' && p.onImport(), 'ghost', 'upload'),
        btn(
          '投稿',
          () => typeof p.onOpenSubmit === 'function' && p.onOpenSubmit(),
          'ghost',
          'send',
          novels.length === 0,
        ),
      ),
    );

    // ---- 正在创作 ---------------------------------------------------------
    // R16 ⑤: three rows, newest first (rollupNovels already sorts by touched),
    // and the remainder behind one 「展开全部」 click.
    const novelFold = foldRows(rollups, novelOpen);
    const novelCard = card(
      '正在创作',
      rollups.length === 0
        ? emptyLine('新建一部小说后，这里会列出最近在写的作品。')
        : NW.h(
            'div',
            null,
            NW.h(
              'ul',
              { className: 'nw-welcome-novels' },
              novelFold.visible.map((row) =>
                NW.h(
                  'li',
                  { key: String(row.novel.id) },
                  NW.h(
                    'button',
                    {
                      type: 'button',
                      className: 'nw-welcome-novel',
                      onClick: () => typeof p.onOpenNovel === 'function' && p.onOpenNovel(row.novel.id),
                    },
                    NW.h('span', { className: 'nw-welcome-novelmark', 'aria-hidden': 'true' }, NW.icon('book', { size: 16 })),
                    NW.h(
                      'span',
                      { className: 'nw-welcome-novelmain' },
                      NW.h('span', { className: 'nw-welcome-novelname' }, row.novel.title || '未命名作品'),
                      NW.h(
                        'span',
                        { className: 'nw-welcome-novelmeta' },
                        `${row.chapters} 章 · ${fmtWords(row.words)} 字 · ${shortDate(row.touched)}`,
                      ),
                    ),
                    NW.h('span', { className: 'nw-welcome-novelgo', 'aria-hidden': 'true' }, NW.icon('chevright', { size: 14 })),
                  ),
                ),
              ),
            ),
            moreRow(novelFold.hidden, novelOpen, () => setNovelOpen((v) => !v)),
          ),
      'wide',
    );

    // ---- 创作统计 ---------------------------------------------------------
    const statCells = [
      { k: '全书', v: fmtWords(stats.total) + ' 字' },
      { k: '本章书', v: fmtWords(stats.novel) + ' 字' },
      { k: '近 7 天', v: fmtWords(stats.weekWords) + ' 字' },
      { k: '今天', v: fmtWords(stats.todayWords) + ' 字' },
    ];
    const statsCard = card(
      '创作统计',
      NW.h(
        'dl',
        { className: 'nw-welcome-stats' },
        statCells.map((cell) =>
          NW.h(
            'div',
            { key: cell.k, className: 'nw-welcome-stat' },
            NW.h('dt', null, cell.k),
            NW.h('dd', null, cell.v),
          ),
        ),
      ),
    );

    // ---- 投稿记录 ---------------------------------------------------------
    // R16 ⑤: same three-row fold as the other cards.
    const subsFold = foldRows(submissions, subsOpen);
    const subsCard = card(
      '投稿记录',
      submissions.length === 0
        ? emptyLine(
            journalCount > 0
              ? `期刊库已收录 ${journalCount} 家，选中一个章节即可开始投稿。`
              : '还没有投稿记录。完成一次投稿后，这里会显示期刊、日期与状态。',
          )
        : NW.h(
            'div',
            null,
            NW.h(
              'ul',
              { className: 'nw-welcome-subs' },
              subsFold.visible.map((row) => {
                const meta = statusOf(row);
                const days = Number(row.daysAgo);
                return NW.h(
                  'li',
                  { key: String(row.id), className: 'nw-welcome-sub' },
                  NW.h(
                    'span',
                    { className: 'nw-welcome-submain' },
                    NW.h('span', { className: 'nw-welcome-subtitle' }, row.title || row.subject || '未命名稿件'),
                    NW.h(
                      'span',
                      { className: 'nw-welcome-submeta' },
                      `${row.journalName || '未指定期刊'} · ${dayStamp(row.at)}` +
                        (Number.isFinite(days) && days > 0 ? ` · ${days} 天前` : ''),
                    ),
                  ),
                  NW.h('span', { className: 'nw-badge', 'data-tone': meta.tone }, meta.label),
                );
              }),
            ),
            moreRow(subsFold.hidden, subsOpen, () => setSubsOpen((v) => !v)),
          ),
      'subs',
    );

    // ---- 收件箱 -----------------------------------------------------------
    // R8 ⑦: the journals answer by mail, so the home screen has to show the
    // mailbox — otherwise a reply only exists inside some web mail tab. The IMAP
    // read takes seconds, which is why this is a card state and not a modal: the
    // rest of the home screen renders immediately.
    const inboxProp = p.inbox && typeof p.inbox === 'object' ? p.inbox : {};
    const inboxMessages = Array.isArray(inboxProp.messages) ? inboxProp.messages : [];
    const inboxUnseen = Number(inboxProp.unseen) || 0;
    const inboxStatus = String(inboxProp.status || 'idle');

    /** RFC 2822 header → `MM-DD` / `HH:MM`, falling back to the raw header. */
    const mailStamp = (value) => {
      const text = String(value || '').trim();
      if (!text) return '';
      const at = Date.parse(text);
      if (!Number.isFinite(at)) return text.slice(0, 24);
      return dayStamp(at);
    };

    let inboxBody;
    if (inboxStatus === 'loading' && inboxMessages.length === 0) {
      // R19 C2: a spinner alone left the card at one line of height and the
      // page jumped when the mail arrived. Three skeleton rows hold the space
      // the real rows will take, so nothing moves.
      inboxBody = NW.h(
        'div',
        { className: 'nw-skel', 'aria-hidden': 'true' },
        NW.h('span', { className: 'nw-skel-row' }),
        NW.h('span', { className: 'nw-skel-row' }),
        NW.h('span', { className: 'nw-skel-row' }),
      );
    } else if (inboxProp.error) {
      inboxBody = NW.h(
        'div',
        null,
        NW.h('p', { className: 'nw-welcome-empty nw-welcome-inboxerr' }, '读取收件箱失败：' + inboxProp.error),
        inboxProp.hint ? NW.h('p', { className: 'nw-welcome-empty' }, inboxProp.hint) : null,
        NW.h(
          'div',
          { className: 'nw-inline', style: { marginTop: '8px' } },
          NW.h(
            'button',
            {
              type: 'button',
              className: 'nw-link',
              onClick: () => typeof p.onRefreshInbox === 'function' && p.onRefreshInbox(),
            },
            tr('刷新'),
          ),
        ),
      );
    } else if (inboxProp.enabled === false) {
      // Configured but switched off: the host deliberately skips the IMAP
      // round trip, so show the switch rather than pretending the box is empty.
      inboxBody = NW.h(
        'div',
        null,
        NW.h('p', { className: 'nw-welcome-empty' }, '收件箱已关闭。打开之后，编辑部的回信会出现在这里。'),
        NW.h(
          'div',
          { className: 'nw-inline', style: { marginTop: '8px' } },
          NW.h(
            'button',
            {
              type: 'button',
              className: 'nw-link',
              onClick: () => typeof p.onOpenSettings === 'function' && p.onOpenSettings(),
            },
            '去打开 →',
          ),
        ),
      );
    } else if (!inboxProp.configured) {
      inboxBody = NW.h(
        'div',
        null,
        NW.h(
          'p',
          { className: 'nw-welcome-empty' },
          '还没有配置收件邮箱。填一次 IMAP 服务器与授权码，编辑部回信就会出现在这里。',
        ),
        NW.h(
          'div',
          { className: 'nw-inline', style: { marginTop: '8px' } },
          NW.h(
            'button',
            {
              type: 'button',
              className: 'nw-link',
              onClick: () => typeof p.onOpenSettings === 'function' && p.onOpenSettings(),
            },
            '去设置 →',
          ),
        ),
      );
    } else if (inboxMessages.length === 0) {
      inboxBody = emptyLine('收件箱是空的。投稿之后，编辑部的回复会出现在这里。');
    } else {
      // R16 ⑤: newest first (the host already sorts by UID descending), three
      // rows, and a per-row delete button.
      const inboxFold = foldRows(inboxMessages, inboxOpen);
      inboxBody = NW.h(
        'div',
        null,
        NW.h(
          'ul',
          { className: 'nw-welcome-subs' },
          inboxFold.visible.map((row, index) =>
            // R12 ④: these rows used to be plain <li> text — the list looked
            // clickable and did nothing. Each one is now a button that opens the
            // mail in a reader dialog (headers + decoded body).
            NW.h(
              'li',
              { key: String(row.uid || row.messageId || index), className: 'nw-welcome-subrow' },
              NW.h(
                'button',
                {
                  type: 'button',
                  className: 'nw-welcome-sub nw-welcome-subbtn' + (row.unseen ? ' nw-welcome-sub-unread' : ''),
                  title: `${String(row.subject || '（无主题）')} — 点击阅读`,
                  onClick: () => {
                    if (typeof p.onOpenMail === 'function') p.onOpenMail(row);
                  },
                },
                NW.h(
                  'span',
                  { className: 'nw-welcome-submain' },
                  NW.h('span', { className: 'nw-welcome-subtitle' }, String(row.subject || '（无主题）')),
                  NW.h(
                    'span',
                    { className: 'nw-welcome-submeta' },
                    `${String(row.from || row.address || '未知发件人')} · ${mailStamp(row.date)}`,
                  ),
                ),
                row.unseen ? NW.h('span', { className: 'nw-badge', 'data-tone': 'brand' }, tr('未读')) : null,
                NW.h('span', { className: 'nw-welcome-subarrow', 'aria-hidden': 'true' }, NW.icon('caret', { size: 14 })),
              ),
              NW.h(
                'button',
                {
                  type: 'button',
                  className: 'nw-welcome-subdel',
                  title: tr('删除这封邮件'),
                  'aria-label': tr('删除这封邮件'),
                  onClick: () => {
                    if (typeof p.onDeleteMail === 'function') p.onDeleteMail(row);
                  },
                },
                NW.icon('trash', { size: 14 }),
              ),
            ),
          ),
        ),
        moreRow(inboxFold.hidden, inboxOpen, () => setInboxOpen((v) => !v)),
      );
    }

    const inboxCard = card(
      '收件箱' + (inboxUnseen > 0 ? ` · ${inboxUnseen} 未读` : ''),
      NW.h('div', null, inboxBody),
      'inbox',
      // R17: the refresh control sits on the title row instead of owning a row
      // of its own above the list.
      inboxProp.configured
        ? NW.h(
            'button',
            {
              type: 'button',
              className: 'nw-welcome-refresh',
              title: tr('刷新收件箱'),
              'aria-label': tr('刷新收件箱'),
              disabled: inboxStatus === 'loading',
              onClick: () => typeof p.onRefreshInbox === 'function' && p.onRefreshInbox(),
            },
            NW.icon('refresh', { size: 14, className: 'nw-welcome-refreshicon' }),
          )
        : null,
    );

    // ---- 快捷入口 ---------------------------------------------------------
    // R17: 继续写作 left this grid — the 「正在创作」 card above already opens
    // the last chapter, so it was the same action twice on one screen.
    const quick = [
      { icon: 'journal', label: '期刊库', onClick: p.onOpenJournals },
      { icon: 'mail', label: '投稿管理', onClick: p.onOpenSubmitManager },
      { icon: 'gear', label: tr('设置'), onClick: p.onOpenSettings },
    ];
    const quickCard = card(
      '快捷入口',
      NW.h(
        'div',
        { className: 'nw-welcome-quick' },
        quick.map((item) =>
          NW.h(
            'button',
            {
              key: item.label,
              type: 'button',
              className: 'nw-welcome-quickbtn',
              disabled: !!item.disabled,
              onClick: () => {
                if (typeof item.onClick === 'function') item.onClick();
              },
            },
            NW.h('span', { className: 'nw-welcome-quickicon', 'aria-hidden': 'true' }, NW.icon(item.icon, { size: 18 })),
            NW.h('span', null, item.label),
          ),
        ),
      ),
    );

    return NW.h(
      'div',
      { className: 'nw-welcome' },
      NW.h(
        'div',
        { className: 'nw-welcome-inner' },
        header,
        NW.h('div', { className: 'nw-welcome-grid' }, novelCard, statsCard),
        NW.h('div', { className: 'nw-welcome-grid' }, inboxCard, subsCard),
        NW.h('div', { className: 'nw-welcome-grid' }, quickCard),
      ),
    );
  }

  NW.Welcome = Welcome;

  // ------------------------------------------------------------------ css ---
  NW.CSS_PARTS.push(`
/* ============================================================== welcome ==
   A reading column, not a dashboard: one max-width container, card surfaces
   derived from the same --nw-* tokens the editor uses, so every theme
   (including 报纸 / 杂志) restyles the home screen for free. */
.nw-welcome{
  height:100%;min-height:0;overflow:auto;
  /* R13: cqw, not vw — the home screen is a column inside the host shell, so a
     1400px window with a 360px host sidebar still gets a ~480px panel. Vertical
     padding stays in vh: an inline-size container has no height axis. */
  padding:clamp(20px,4vh,48px) clamp(16px,4cqw,40px);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-ui-font);
  -webkit-font-smoothing:antialiased;
}
.nw-welcome-inner{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:var(--nw-sp-5);}
.nw-btn-icon{display:inline-flex;align-items:center;flex:0 0 auto;}

.nw-welcome-head{
  position:relative;
  display:flex;align-items:flex-end;justify-content:space-between;gap:var(--nw-sp-4);flex-wrap:wrap;
  padding-bottom:var(--nw-sp-5);
}
/* R19 B4: the home screen had no focal point — a title, a sentence, three
   buttons, then four identical cards. The hero rule gives the eye a place to
   land and separates "what this is" from "what you do next". It fades out to
   the right so it reads as a gesture, not as a table border. */
.nw-welcome-head::after{
  content:'';position:absolute;left:0;right:0;bottom:0;height:1px;
  background:linear-gradient(90deg, var(--nw-line-strong), var(--nw-line-soft) 42%, transparent 88%);
}
.nw-welcome-headtext{min-width:0;flex:1 1 320px;}
.nw-welcome-title{
  margin:0 0 var(--nw-sp-0);font-family:var(--nw-reading-font);font-weight:600;
  font-size:clamp(24px,2.9cqw,31px);line-height:1.2;letter-spacing:.005em;color:var(--nw-fg);
}
/* R21: this rule used to live on .nw-welcome-sub, which is ALSO the class of a
   submission / mail row (flex, 8px padding, --nw-sunken fill). The header line
   therefore rendered as a grey capsule with the summary text floating inside
   it. The header keeps its own name now. */
.nw-welcome-lead{margin:0;font-size:var(--nw-fs-second);line-height:1.6;color:var(--nw-fg-soft);}
.nw-welcome-actions{display:flex;align-items:center;gap:var(--nw-sp-2);flex-wrap:wrap;}

/* min(280px,100%) — a plain minmax(280px,1fr) overflows as soon as the panel
   itself is narrower than 280px, which happens the moment the host sidebar is
   open on a laptop. */
/* R21: cards hug their own content (align-items:start). Stretching them made a
   one-row card (正在创作 with a single novel) into a half-empty panel, which read
   worse than a shorter card. */
.nw-welcome-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:var(--nw-sp-4);align-items:start;}
.nw-welcome-card{
  min-width:0;padding:var(--nw-sp-4);
  border:1px solid var(--nw-line-soft);
  border-radius:var(--nw-r-card);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-shadow-1);
}
.nw-welcome-cardtitle{
  margin:0 0 var(--nw-sp-3);
  font-size:var(--nw-fs-micro);font-weight:600;letter-spacing:.06em;text-transform:none;
  color:var(--nw-fg-soft);
}
/* R19 C2: skeleton placeholders. The sweep is one gradient travelling across a
   muted bar; it stops entirely under prefers-reduced-motion. */
.nw-skel{display:flex;flex-direction:column;gap:var(--nw-sp-1);padding:var(--nw-sp-0) 0;}
.nw-skel-row{
  display:block;height:34px;border-radius:var(--nw-r-control);
  background:linear-gradient(90deg,
    color-mix(in srgb, var(--nw-fg) 6%, transparent) 0%,
    color-mix(in srgb, var(--nw-fg) 12%, transparent) 42%,
    color-mix(in srgb, var(--nw-fg) 6%, transparent) 84%);
  background-size:220% 100%;
  animation:nw-skel 1.25s ease-in-out infinite;
}
@keyframes nw-skel{from{background-position:120% 0;}to{background-position:-20% 0;}}
.nw-welcome-empty{margin:0;font-size:var(--nw-fs-second);line-height:1.7;color:var(--nw-fg-soft);}

/* -------------------------------------------------------- 正在创作 ----- */
.nw-welcome-novels{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;}
.nw-welcome-novel{
  display:flex;align-items:center;gap:var(--nw-sp-3);width:100%;
  padding:9px 8px;border:0;border-radius:var(--nw-r-control);
  background:transparent;color:inherit;text-align:left;cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-second);
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-welcome-novel:hover{background:var(--nw-sunken);}
.nw-welcome-novel:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-novelmark{color:var(--nw-fg-soft);display:flex;flex:0 0 auto;}
.nw-welcome-novelmain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}
.nw-welcome-novelname{font-weight:500;color:var(--nw-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-welcome-novelmeta{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-welcome-novelgo{color:var(--nw-idle);display:flex;flex:0 0 auto;}

/* -------------------------------------------------------- 创作统计 ----- */
/* R21: auto-fit gave three columns inside the card, so the fourth cell (今天)
   dropped alone onto a second row and the block looked broken. Four cells want
   a deliberate 2x2, not whatever the width happens to allow. */
.nw-welcome-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--nw-sp-2);margin:0;}
.nw-welcome-stat{
  padding:var(--nw-sp-2) var(--nw-sp-3);border-radius:var(--nw-r-control);
  background:var(--nw-sunken);
}
.nw-welcome-stat dt{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);}
.nw-welcome-stat dd{
  margin:2px 0 0;font-family:var(--nw-reading-font);font-weight:600;
  font-size:16px;line-height:1.3;color:var(--nw-fg);font-variant-numeric:tabular-nums;
}

/* -------------------------------------------------------- 投稿记录 ----- */
.nw-welcome-subs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--nw-sp-0);}
.nw-welcome-sub{
  display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-3);
  padding:8px 10px;border-radius:var(--nw-r-control);background:var(--nw-sunken);
}
.nw-welcome-submain{display:flex;flex-direction:column;gap:2px;min-width:0;}
.nw-welcome-subtitle{font-size:var(--nw-fs-second);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-welcome-submeta{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* -------------------------------------------------------- 收件箱 ------- */
/* Unread is a left rule rather than a bolder title: the card is narrow and the
   subject line is already truncated, so weight alone disappears. */
.nw-welcome-sub-unread{
  background:color-mix(in srgb, var(--nw-brand) 8%, var(--nw-sunken));
  box-shadow:inset 2px 0 0 var(--nw-brand);
}

/* R12 ④: the row is a real button now, so it needs the button resets that the
   generic .nw-welcome-sub never had (it started life as a static li). */
.nw-welcome-subbtn{
  width:100%;border:1px solid transparent;font-family:inherit;text-align:left;
  color:var(--nw-fg);cursor:pointer;
  transition:background var(--nw-dur) ease,border-color var(--nw-dur) ease,transform var(--nw-dur) ease;
}
.nw-welcome-subbtn:hover{
  border-color:var(--nw-line-strong);
  background:color-mix(in srgb, var(--nw-fg) 6%, var(--nw-sunken));
}
.nw-welcome-subbtn:hover .nw-welcome-subarrow{opacity:1;transform:none;}
.nw-welcome-subbtn:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-subarrow{
  display:inline-flex;flex:0 0 auto;color:var(--nw-fg-soft);
  opacity:0;transform:translateX(-3px);
  transition:opacity var(--nw-dur) ease,transform var(--nw-dur) ease;
}
.nw-welcome-sub-unread .nw-welcome-subtitle{font-weight:600;}

/* R16 ⑤: an inbox row is now button + delete button side by side. The delete
   sits outside the reading button so a mis-click never opens the mail, and it
   only becomes visible on hover/focus — the list stays quiet until you aim. */
.nw-welcome-subrow{display:flex;align-items:stretch;gap:4px;}
.nw-welcome-subrow > .nw-welcome-subbtn{flex:1 1 auto;min-width:0;}
.nw-welcome-subdel{
  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:30px;padding:0;border-radius:var(--nw-r-control);
  border:1px solid transparent;background:transparent;
  color:var(--nw-fg-soft);font-family:inherit;cursor:pointer;
  opacity:0;transition:opacity var(--nw-dur) ease,color var(--nw-dur) ease,background var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-welcome-subrow:hover .nw-welcome-subdel,
.nw-welcome-subdel:focus-visible{opacity:1;}
.nw-welcome-subdel:hover{
  color:var(--nw-danger);
  border-color:color-mix(in srgb, var(--nw-danger) 34%, transparent);
  background:color-mix(in srgb, var(--nw-danger) 10%, transparent);
}
.nw-welcome-subdel:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

/* R16 ⑤: the fold footer shared by all three cards. */
.nw-welcome-more{
  display:flex;align-items:center;justify-content:center;gap:var(--nw-sp-0);
  width:100%;margin-top:var(--nw-sp-1);padding:6px 10px;
  border-radius:var(--nw-r-control);border:1px solid var(--nw-line);
  background:transparent;color:var(--nw-fg-soft);
  font-family:inherit;font-size:var(--nw-fs-micro);cursor:pointer;
  transition:color var(--nw-dur) ease,border-color var(--nw-dur) ease,background var(--nw-dur) ease;
}
.nw-welcome-more:hover{
  color:var(--nw-fg);
  border-color:var(--nw-line-strong);
  background:color-mix(in srgb, var(--nw-fg) 5%, transparent);
}
.nw-welcome-more:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-moreico{display:inline-flex;flex:0 0 auto;}
.nw-welcome-inboxbusy{padding:4px 0;}
.nw-welcome-inboxerr{color:var(--nw-danger);}
/* .nw-link is written for anchors; on a <button> the UA background/border/padding
   have to be cleared or the refresh link renders as a grey pill.
   No underline here: on the home screen these are inline actions sitting inside
   a text line, and a rule under them reads as a broken border rather than as a
   link. Colour + hover is enough. */
.nw-welcome .nw-link{border-bottom:0;text-decoration:none;color:var(--nw-brand);}
.nw-welcome button.nw-link{
  padding:0;background:none;border:0;cursor:pointer;font-family:inherit;
  border-bottom:0;text-decoration:none;color:var(--nw-brand);
}
.nw-welcome button.nw-link:hover{text-decoration:underline;text-underline-offset:2px;}
.nw-welcome button.nw-link:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

/* Status badge — one shape, five tones; the tones ride the alias state tokens
   so a dark theme flips them without a second rule. */
.nw-badge{
  flex:0 0 auto;display:inline-flex;align-items:center;
  height:20px;padding:0 8px;border-radius:var(--nw-r-pill);
  font-size:var(--nw-fs-tiny);line-height:1;white-space:nowrap;
  background:color-mix(in srgb, var(--nw-fg-soft) 12%, transparent);
  color:var(--nw-fg-soft);
}
.nw-badge[data-tone="info"]{background:color-mix(in srgb, var(--nw-brand) 16%, transparent);color:var(--nw-brand);}
.nw-badge[data-tone="ok"]{background:color-mix(in srgb, var(--nw-ok) 18%, transparent);color:var(--nw-ok);}
.nw-badge[data-tone="danger"]{background:color-mix(in srgb, var(--nw-danger) 16%, transparent);color:var(--nw-danger);}
.nw-badge[data-tone="brand"]{background:color-mix(in srgb, var(--nw-brand) 22%, transparent);color:var(--nw-brand);}
.nw-badge[data-tone="idle"]{background:color-mix(in srgb, var(--nw-fg-soft) 10%, transparent);color:var(--nw-fg-soft);}

/* -------------------------------------------------------- 快捷入口 ----- */
.nw-welcome-quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:var(--nw-sp-2);}
.nw-welcome-quickbtn{
  display:flex;align-items:center;gap:var(--nw-sp-2);
  padding:12px 14px;border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-surface-1);color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-second);text-align:left;
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-welcome-quickbtn:hover:not(:disabled){
  background:var(--nw-surface-2);border-color:var(--nw-line-strong);
  box-shadow:var(--nw-shadow-1);transform:translateY(-1px);
}
.nw-welcome-quickbtn:active:not(:disabled){transform:none;box-shadow:none;}
.nw-welcome-quickbtn:disabled{opacity:.45;cursor:default;}
.nw-welcome-quickbtn:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-quickicon{
  color:var(--nw-fg-soft);display:flex;flex:0 0 auto;
  width:26px;height:26px;align-items:center;justify-content:center;
  border-radius:var(--nw-r-control);background:color-mix(in srgb, var(--nw-fg) 6%, transparent);
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-welcome-quickbtn:hover:not(:disabled) .nw-welcome-quickicon{background:var(--nw-brand);color:var(--nw-bg);}

/* R17: card header row — title on the left, one inline action on the right. */
.nw-welcome-cardhead{display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-2);margin:0 0 var(--nw-sp-3);}
.nw-welcome-cardhead .nw-welcome-cardtitle{margin:0;}
.nw-welcome-cardact{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;}
.nw-welcome-refresh{
  display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);cursor:pointer;
  transition:background-color var(--nw-dur) ease,color var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-welcome-refresh:hover:not(:disabled){background:var(--nw-sunken);border-color:var(--nw-line);color:var(--nw-fg);}
.nw-welcome-refresh:disabled{opacity:.5;cursor:default;}
.nw-welcome-refresh:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-refresh:disabled .nw-welcome-refreshicon{animation:nw-refresh-spin 1s linear infinite;}
@keyframes nw-refresh-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@media (prefers-reduced-motion: reduce){
  .nw-welcome-quickbtn{transition:none;}
  .nw-welcome-quickbtn:hover:not(:disabled){transform:none;}
  .nw-welcome-refresh:disabled .nw-welcome-refreshicon{animation:none;}
  .nw-skel-row{animation:none;background:color-mix(in srgb, var(--nw-fg) 8%, transparent);}
}

/* R13: container tiers, not window tiers — the home screen is a column. */
@container nw (max-width: 620px){
  .nw-welcome{padding:20px 14px;}
  .nw-welcome-stats,.nw-welcome-quick{grid-template-columns:minmax(0,1fr);}
}
`);
})();
