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

  function card(titleText, children, tone) {
    return NW.h(
      'section',
      { className: 'nw-welcome-card' + (tone ? ' nw-welcome-card-' + tone : '') },
      NW.h('h2', { className: 'nw-welcome-cardtitle' }, titleText),
      children,
    );
  }

  function emptyLine(text) {
    return NW.h('p', { className: 'nw-welcome-empty' }, text);
  }

  function Welcome(props) {
    const p = props || {};
    const novels = Array.isArray(p.novels) ? p.novels.filter(Boolean) : [];
    const chapters = Array.isArray(p.chapters) ? p.chapters : [];
    const submissions = Array.isArray(p.submissions) ? p.submissions : [];
    const stats = computeStats(chapters, p.activeNovelId);
    const rollups = rollupNovels(novels, chapters);
    const journalCount = Number(p.journalCount) || 0;

    // NW.ui.btn renders `children` verbatim, so the icon is prepended as a
    // keyed sibling span rather than passed as a separate prop.
    const btn = (label, onClick, kind, iconName, disabled) =>
      NW.ui.btn({
        kind: kind || 'ghost',
        onClick: onClick,
        disabled: !!disabled,
        children: iconName
          ? [
              NW.h('span', { key: 'i', className: 'nw-btn-icon', 'aria-hidden': 'true' }, NW.icon(iconName, { size: 15 })),
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
          { className: 'nw-welcome-sub' },
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
    const novelCard = card(
      '正在创作',
      rollups.length === 0
        ? emptyLine('新建一部小说后，这里会列出最近在写的作品。')
        : NW.h(
            'ul',
            { className: 'nw-welcome-novels' },
            rollups.slice(0, 6).map((row) =>
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
    const subRows = submissions.slice(0, 5);
    const subsCard = card(
      '投稿记录',
      subRows.length === 0
        ? emptyLine(
            journalCount > 0
              ? `期刊库已收录 ${journalCount} 家，选中一个章节即可开始投稿。`
              : '还没有投稿记录。完成一次投稿后，这里会显示期刊、日期与状态。',
          )
        : NW.h(
            'ul',
            { className: 'nw-welcome-subs' },
            subRows.map((row) => {
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
      inboxBody = NW.h('div', { className: 'nw-welcome-inboxbusy' }, NW.ui.spinner('正在读取收件箱…'));
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
      inboxBody = NW.h(
        'ul',
        { className: 'nw-welcome-subs' },
        inboxMessages.slice(0, 6).map((row, index) =>
          NW.h(
            'li',
            {
              key: String(row.uid || row.messageId || index),
              className: 'nw-welcome-sub' + (row.unseen ? ' nw-welcome-sub-unread' : ''),
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
          ),
        ),
      );
    }

    const inboxCard = card(
      '收件箱' + (inboxUnseen > 0 ? ` · ${inboxUnseen} 未读` : ''),
      NW.h(
        'div',
        null,
        inboxProp.configured
          ? NW.h(
              'div',
              { className: 'nw-inline', style: { justifyContent: 'flex-end', marginBottom: '6px' } },
              NW.h(
                'button',
                {
                  type: 'button',
                  className: 'nw-link',
                  onClick: () => typeof p.onRefreshInbox === 'function' && p.onRefreshInbox(),
                },
                inboxStatus === 'loading' ? '刷新中…' : tr('刷新'),
              ),
            )
          : null,
        inboxBody,
      ),
      'inbox',
    );

    // ---- 快捷入口 ---------------------------------------------------------
    const quick = [
      { icon: 'typewriter', label: '继续写作', onClick: p.onResume, disabled: !p.hasChapter },
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
   (including 报纸 / 国风 / 极简卡片) restyles the home screen for free. */
.nw-welcome{
  height:100%;min-height:0;overflow:auto;
  padding:clamp(20px,4vh,48px) clamp(16px,4vw,40px);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-ui-font);
  -webkit-font-smoothing:antialiased;
}
.nw-welcome-inner{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:var(--nw-sp-5);}
.nw-btn-icon{display:inline-flex;align-items:center;flex:0 0 auto;}

.nw-welcome-head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--nw-sp-4);flex-wrap:wrap;}
.nw-welcome-headtext{min-width:0;flex:1 1 320px;}
.nw-welcome-title{
  margin:0 0 6px;font-family:var(--nw-reading-font);font-weight:600;
  font-size:clamp(22px,2.6vw,28px);line-height:1.25;letter-spacing:.01em;color:var(--nw-fg);
}
.nw-welcome-sub{margin:0;font-size:var(--nw-fs-second);line-height:1.6;color:var(--nw-fg-soft);}
.nw-welcome-actions{display:flex;align-items:center;gap:var(--nw-sp-2);flex-wrap:wrap;}

.nw-welcome-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--nw-sp-4);align-items:start;}
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
.nw-welcome-empty{margin:0;font-size:var(--nw-fs-second);line-height:1.7;color:var(--nw-fg-soft);}

/* -------------------------------------------------------- 正在创作 ----- */
.nw-welcome-novels{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;}
.nw-welcome-novel{
  display:flex;align-items:center;gap:var(--nw-sp-3);width:100%;
  padding:9px 8px;border:0;border-radius:var(--nw-r-control);
  background:transparent;color:inherit;text-align:left;cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-second);
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-welcome-novel:hover{background:var(--nw-sunken);}
.nw-welcome-novel:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-novelmark{color:var(--nw-fg-soft);display:flex;flex:0 0 auto;}
.nw-welcome-novelmain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}
.nw-welcome-novelname{font-weight:500;color:var(--nw-fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-welcome-novelmeta{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-welcome-novelgo{color:var(--nw-idle);display:flex;flex:0 0 auto;}

/* -------------------------------------------------------- 创作统计 ----- */
.nw-welcome-stats{display:grid;grid-template-columns:1fr 1fr;gap:var(--nw-sp-3);margin:0;}
.nw-welcome-stat{
  padding:var(--nw-sp-3);border-radius:var(--nw-r-control);
  background:var(--nw-sunken);
}
.nw-welcome-stat dt{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);}
.nw-welcome-stat dd{
  margin:4px 0 0;font-family:var(--nw-reading-font);font-weight:600;
  font-size:15px;line-height:1.3;color:var(--nw-fg);font-variant-numeric:tabular-nums;
}

/* -------------------------------------------------------- 投稿记录 ----- */
.nw-welcome-subs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}
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
.nw-welcome-sub-unread .nw-welcome-subtitle{font-weight:600;}
.nw-welcome-inboxbusy{padding:4px 0;}
.nw-welcome-inboxerr{color:var(--nw-danger);}
/* .nw-link is written for anchors; on a <button> the UA background/border/padding
   have to be cleared or the refresh link renders as a grey pill. */
.nw-welcome button.nw-link{
  padding:0;background:none;border:0;cursor:pointer;font-family:inherit;
  border-bottom:1px solid color-mix(in srgb, var(--nw-brand) 30%, transparent);
}
.nw-welcome button.nw-link:hover{border-bottom-color:var(--nw-brand);}
.nw-welcome button.nw-link:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

/* Status badge — one shape, five tones; the tones ride the alias state tokens
   so a dark theme flips them without a second rule. */
.nw-badge{
  flex:0 0 auto;display:inline-flex;align-items:center;
  height:20px;padding:0 8px;border-radius:var(--nw-r-pill);
  font-size:11.5px;line-height:1;white-space:nowrap;
  background:color-mix(in srgb, var(--nw-fg-soft) 12%, transparent);
  color:var(--nw-fg-soft);
}
.nw-badge[data-tone="info"]{background:color-mix(in srgb, var(--nw-brand) 16%, transparent);color:var(--nw-brand);}
.nw-badge[data-tone="ok"]{background:color-mix(in srgb, var(--nw-ok) 18%, transparent);color:var(--nw-ok);}
.nw-badge[data-tone="danger"]{background:color-mix(in srgb, var(--nw-danger) 16%, transparent);color:var(--nw-danger);}
.nw-badge[data-tone="brand"]{background:color-mix(in srgb, var(--nw-brand) 22%, transparent);color:var(--nw-brand);}
.nw-badge[data-tone="idle"]{background:color-mix(in srgb, var(--nw-fg-soft) 10%, transparent);color:var(--nw-fg-soft);}

/* -------------------------------------------------------- 快捷入口 ----- */
.nw-welcome-quick{display:grid;grid-template-columns:1fr 1fr;gap:var(--nw-sp-2);}
.nw-welcome-quickbtn{
  display:flex;align-items:center;gap:8px;
  padding:10px 12px;border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-surface-1);color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-second);text-align:left;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    border-color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-welcome-quickbtn:hover:not(:disabled){background:var(--nw-surface-2);border-color:var(--nw-line-strong);}
.nw-welcome-quickbtn:disabled{opacity:.45;cursor:default;}
.nw-welcome-quickbtn:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-welcome-quickicon{color:var(--nw-fg-soft);display:flex;flex:0 0 auto;}

@media (max-width: 620px){
  .nw-welcome{padding:20px 14px;}
  .nw-welcome-stats,.nw-welcome-quick{grid-template-columns:1fr;}
}
`);
})();
