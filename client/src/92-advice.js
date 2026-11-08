;(() => {
  'use strict';

  /**
   * 修改建议 (R73–R76) — 卡片、已接收、悬浮坞那一栏、选中改写窗口。
   *
   * 从 90-app.js 里拆出来：那一半是「工作室」（目录、编辑器、状态、弹窗接线），
   * 这一半是「意见」——它自己的缓存、diff、剪贴板、键盘，和工作室只通过
   * props（editorApi / accepted / onAccept / onToast）说话。
   */
  const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ========================== R73：修改建议的卡片与已接收 ==================== */


  /** Same message helper the rest of the client uses (each part keeps its own). */
  function errText(err, fallback) {
    const text = err && err.message ? String(err.message) : '';
    return text || fallback || '未知错误';
  }

  /** Clamp a number into [lo, hi]; non-finite input falls back to `lo`. */
  function clampNum(value, lo, hi) {
    const n = Number(value);
    if (!Number.isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  /** Keep a 0..1 scroll ratio inside its bounds. */
  function clampRatio(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }


  /** ①②③… — the order the same stretch of text was revised in. */
  function ordinalMark(n) {
    const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
    const i = Math.max(0, Math.floor(Number(n) || 0));
    return i < marks.length ? marks.charAt(i) : String(i + 1);
  }

  /**
   * Where an accepted suggestion's words are in the text **right now**.
   *
   * The stored offsets are kept honest by db.shiftRevisionsForEdit while this
   * window edits the chapter, but a rewrite from elseWhere (a phone edit, a
   * restored version) can leave them pointing at the wrong characters. The quote
   * is the durable half, so it wins whenever the offsets no longer spell it.
   */
  function locateRevision(row, text) {
    const source = String(text == null ? '' : text);
    const quote = String((row && row.quote) || '');
    const start = Math.round(Number(row && row.start));
    const end = Math.round(Number(row && row.end));
    if (quote && start >= 0 && end > start && source.slice(start, end) === quote) {
      return { start: start, end: end, found: true };
    }
    if (quote) {
      const at = source.indexOf(quote);
      if (at >= 0) return { start: at, end: at + quote.length, found: true };
    }
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
      return { start: start, end: end, found: false };
    }
    return { start: -1, end: -1, found: false };
  }

  /**
   * 一个区域改了两次以上，就放在一起。
   *
   * "The same region" is decided by overlap, not by exact offsets: accepting the
   * first suggestion does not move a single character (accepting means "this is
   * right, I will type it"), so the second round lands on the same words and the
   * two records must read as one story — ① then ②, in the order they happened.
   */
  function groupRevisions(rows, text) {
    const list = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((row) => Object.assign({}, row, locateRevision(row, text)))
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    const groups = [];
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i];
      let hit = null;
      for (let g = 0; g < groups.length && !hit; g += 1) {
        const grp = groups[g];
        for (let r = 0; r < grp.rows.length; r += 1) {
          const other = grp.rows[r];
          const overlaps = row.start >= 0 && other.start >= 0
            && row.start < other.end && other.start < row.end;
          const sameQuote = row.quote && String(row.quote) === String(other.quote);
          if (overlaps || sameQuote) {
            hit = grp;
            break;
          }
        }
      }
      if (!hit) {
        hit = { rows: [] };
        groups.push(hit);
      }
      hit.rows.push(row);
    }
    return groups;
  }

  /* ========================= R76：并排对照的字符级差异 ==================== */

  /** Tiny LRU for `diffChars` results — a re-render must not redo the LCS. */
  const DIFF_CACHE = new Map();
  const DIFF_CACHE_MAX = 64;
  /** Above this length a character diff is noise (and slow); show plain text. */
  const DIFF_LIMIT = 400;

  /**
   * Character-level diff between 原文 and 改后.
   *
   * "在这一层楼里安静地等待着" → "在楼道里等着" is one or two words changed, but
   * side-by-side paragraphs make the writer re-read both to find them. Marking
   * the removed characters on the left and the added ones on the right is the
   * difference between "looks similar" and "here is the change".
   *
   * Common prefix/suffix are trimmed first (usually most of the sentence), then
   * a plain LCS over what is left. Chinese has no word breaks, so per-character
   * is the honest granularity and also the cheapest.
   */
  function diffChars(beforeRaw, afterRaw) {
    const a = String(beforeRaw == null ? '' : beforeRaw);
    const b = String(afterRaw == null ? '' : afterRaw);
    const plain = () => ({ old: [{ text: a, changed: false }], neu: [{ text: b, changed: false }] });
    if (a === b) return { old: [{ text: a, changed: false }], neu: [{ text: b, changed: false }] };
    if (a.length > DIFF_LIMIT || b.length > DIFF_LIMIT) return plain();
    const key = a + '\u0000' + b;
    const cached = DIFF_CACHE.get(key);
    if (cached) return cached;

    let start = 0;
    while (start < a.length && start < b.length && a.charAt(start) === b.charAt(start)) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a.charAt(endA - 1) === b.charAt(endB - 1)) {
      endA -= 1;
      endB -= 1;
    }
    const midA = a.slice(start, endA).split('');
    const midB = b.slice(start, endB).split('');
    const n = midA.length;
    const m = midB.length;
    // dp[i][j] = LCS length of midA[i..], midB[j..]
    const dp = [];
    for (let i = 0; i <= n; i += 1) dp.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = midA[i] === midB[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const oldSegs = [];
    const neuSegs = [];
    const push = (arr, ch, changed) => {
      const last = arr[arr.length - 1];
      if (last && last.changed === changed) last.text += ch;
      else arr.push({ text: ch, changed: changed });
    };
    if (start > 0) {
      oldSegs.push({ text: a.slice(0, start), changed: false });
      neuSegs.push({ text: b.slice(0, start), changed: false });
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push(oldSegs, midA[i], false);
        push(neuSegs, midB[j], false);
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        push(oldSegs, midA[i], true);
        i += 1;
      } else {
        push(neuSegs, midB[j], true);
        j += 1;
      }
    }
    while (i < n) {
      push(oldSegs, midA[i], true);
      i += 1;
    }
    while (j < m) {
      push(neuSegs, midB[j], true);
      j += 1;
    }
    if (endA < a.length) {
      oldSegs.push({ text: a.slice(endA), changed: false });
      neuSegs.push({ text: b.slice(endB), changed: false });
    }
    const out = { old: oldSegs, neu: neuSegs };
    if (DIFF_CACHE.size >= DIFF_CACHE_MAX) {
      const first = DIFF_CACHE.keys().next();
      if (!first.done) DIFF_CACHE.delete(first.value);
    }
    DIFF_CACHE.set(key, out);
    return out;
  }

  /** Render one side of a diff as text + <mark> runs. */
  function diffNodes(segments, kind) {
    const list = Array.isArray(segments) ? segments : [];
    return list.map((seg, index) =>
      seg.changed
        ? h(
            'mark',
            {
              key: 'd' + index,
              className: kind === 'old' ? 'nw-diff-del' : 'nw-diff-add',
            },
            seg.text,
          )
        : seg.text,
    );
  }

  /* ========================= R76：建议结果的本地缓存 ====================== */

  /**
   * Reopening the window for the same words must not bill the model again.
   *
   * Keyed on chapter + range + *fingerprint of the text*, so an edit invalidates
   * the entry instead of showing advice about a sentence that no longer exists.
   * Module scope on purpose: closing the window unmounts the component, and the
   * cache has to outlive that. Small LRU so a long session cannot grow forever.
   */
  // R93: the cache used to live only in this module's memory, so reloading the
  // plugin (or the page) threw away every unaccepted suggestion. Mirror it into
  // localStorage — same 12-entry LRU, but it now survives a restart.
  const ADVICE_CACHE_KEY = 'nw.advice.cache.v1';
  const ADVICE_CACHE_MAX = 12;

  function readAdviceStore() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(ADVICE_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      return Object.keys(parsed)
        .map((key) => [key, parsed[key]])
        .filter((pair) => pair[1] && Array.isArray(pair[1].items));
    } catch (err) {
      // Storage disabled or the payload is corrupt: start clean, never break
      // the panel over a cache.
      return [];
    }
  }

  const ADVICE_CACHE = new Map(readAdviceStore().slice(-ADVICE_CACHE_MAX));

  function persistAdviceCache() {
    try {
      if (typeof localStorage === 'undefined') return;
      const out = {};
      ADVICE_CACHE.forEach((value, key) => {
        out[key] = value;
      });
      localStorage.setItem(ADVICE_CACHE_KEY, JSON.stringify(out));
    } catch (err) {
      // Quota exceeded / private mode: the in-memory cache still works for this
      // session, which is what the old behaviour did all along.
    }
  }

  function textFingerprint(text) {
    const s = String(text == null ? '' : text);
    let hash = 5381;
    // R82: hash the whole text. The old 4000-char cap meant an equal-length edit
    // deep inside a long chapter produced the same fingerprint, so reopening the
    // column showed advice about text that no longer existed.
    for (let i = 0; i < s.length; i += 1) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
    return hash.toString(36) + ':' + s.length;
  }

  function cacheGet(key) {
    if (!key || !ADVICE_CACHE.has(key)) return null;
    const hit = ADVICE_CACHE.get(key);
    // Refresh recency so the entries actually used survive the eviction.
    ADVICE_CACHE.delete(key);
    ADVICE_CACHE.set(key, hit);
    return hit;
  }

  function cachePut(key, value) {
    if (!key || !value) return;
    if (ADVICE_CACHE.has(key)) ADVICE_CACHE.delete(key);
    ADVICE_CACHE.set(key, value);
    while (ADVICE_CACHE.size > ADVICE_CACHE_MAX) {
      const first = ADVICE_CACHE.keys().next();
      if (first.done) break;
      ADVICE_CACHE.delete(first.value);
    }
    persistAdviceCache();
  }

  function cacheDel(key) {
    if (!key || !ADVICE_CACHE.has(key)) return;
    ADVICE_CACHE.delete(key);
    persistAdviceCache();
  }

  /**
   * Copy text to the clipboard; resolves false when every channel refuses.
   *
   * R87: the WebView can deny `navigator.clipboard.writeText` (permission
   * policy) and `execCommand('copy')` can quietly return false when the
   * textarea never receives focus. So the order is: async clipboard → host
   * clipboard (Electron / clip.exe / pbcopy) → focused textarea. The host path
   * is the one that makes a whole-chapter copy dependable.
   */
  async function copyToClipboard(text) {
    const value = String(text == null ? '' : text);
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      /* fall through */
    }
    try {
      if (NW.io && NW.io.clipboard && typeof NW.io.clipboard.write === 'function') {
        await NW.io.clipboard.write(value);
        return true;
      }
    } catch (err) {
      /* fall through */
    }
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.left = '0';
      area.style.width = '1px';
      area.style.height = '1px';
      area.style.padding = '0';
      area.style.border = '0';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, value.length);
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(area);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * One suggestion.
   *
   * Two shapes, one component: when the model returned a rewrite it is shown as
   * 原文 | 改后 side by side (that is the whole point of the selection window);
   * when it only gave advice the card falls back to the editorial layout.
   *
   * The frame colour is the decision: pending is the page's own line colour,
   * accepted is green, rejected is red. Accepting is not applied to the
   * manuscript — see `onAccept` in the App — so the card has to say out loud
   * what the writer already decided.
   */
  function AdviceCard(props) {
    const p = props || {};
    const item = p.item || {};
    const state = p.state || 'pending';
    const quote = String(item.quote || '');
    const revised = String(item.revised || item.example || '');
    const advice = String(item.advice || '');
    const issue = String(item.issue || '');
    const why = String(item.why || '');
    const busy = !!p.busy;
    const applied = !!p.applied;
    const canDecide = state !== 'accepted' && state !== 'rejected';
    // R76: the two columns are also a diff — deleted characters on the left,
    // added ones on the right.
    const diff = revised ? diffChars(quote, revised) : null;
    const KIND = {
      rhythm: '节奏', diction: '用词', pov: '视角', detail: '画面', dialogue: '对话',
      structure: '结构', character: '人物', logic: '逻辑', emotion: '情绪', redundancy: '冗余',
    };
    return h(
      'div',
      {
        className: 'nw-adv',
        'data-state': state,
        'data-applied': applied ? '1' : '0',
        'data-active': p.active ? '1' : '0',
        tabIndex: 0,
        role: 'group',
        'aria-label': NW.t('修改建议'),
        onClick: () => {
          if (typeof p.onReveal === 'function') p.onReveal(item);
        },
        onKeyDown: (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          if (typeof p.onReveal === 'function') p.onReveal(item);
        },
        title: NW.t('点击定位到正文'),
      },
      revised
        ? h(
            'div',
            { className: 'nw-adv-compare' },
            h(
              'div',
              { className: 'nw-adv-side', 'data-kind': 'old' },
              h('span', { className: 'nw-adv-tag' }, NW.t('原文')),
              h('div', { className: 'nw-adv-txt' }, diffNodes(diff.old, 'old')),
            ),
            h(
              'div',
              { className: 'nw-adv-side', 'data-kind': 'new' },
              h('span', { className: 'nw-adv-tag' }, NW.t('改后')),
              h('div', { className: 'nw-adv-txt' }, diffNodes(diff.neu, 'new')),
            ),
          )
        : h(
            'div',
            { className: 'nw-adv-side', 'data-kind': 'old' },
            h('span', { className: 'nw-adv-tag' }, NW.t('原文')),
            h('div', { className: 'nw-adv-txt' }, quote),
          ),
      // R76: what you can do with the rewrite, right under it. 替换 writes it
      // into the manuscript (undoable for as long as that span still holds the
      // replaced text); 复制 leaves the text alone.
      revised
        ? h(
            'div',
            { className: 'nw-adv-acts' },
            h(
              'button',
              {
                type: 'button',
                className: 'nw-adv-mini',
                disabled: busy,
                onClick: (ev) => {
                  ev.stopPropagation();
                  if (typeof p.onCopy === 'function') p.onCopy(item);
                },
              },
              NW.icon('doc', { size: 11 }),
              NW.t('复制'),
            ),
            applied
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-adv-mini',
                    'data-kind': 'undo',
                    disabled: busy,
                    onClick: (ev) => {
                      ev.stopPropagation();
                      if (typeof p.onUndoApply === 'function') p.onUndoApply(item);
                    },
                  },
                  NW.icon('refresh', { size: 11 }),
                  NW.t('撤销替换'),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-adv-mini',
                    'data-kind': 'apply',
                    disabled: busy,
                    onClick: (ev) => {
                      ev.stopPropagation();
                      if (typeof p.onApply === 'function') p.onApply(item);
                    },
                  },
                  NW.icon('pencil', { size: 11 }),
                  NW.t('替换到正文'),
                ),
            typeof p.onRegenerate === 'function'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-adv-mini',
                    disabled: busy,
                    title: NW.t('拿这一版当起点，再要一版不同的'),
                    onClick: (ev) => {
                      ev.stopPropagation();
                      p.onRegenerate(item);
                    },
                  },
                  NW.icon('sparkle', { size: 11 }),
                  NW.t('再改一版'),
                )
              : null,
            Number(p.variant) > 1
              ? h('span', { className: 'nw-adv-ver' }, NW.t('第 {0} 版', p.variant))
              : null,
          )
        : null,
      issue ? h('div', { className: 'nw-adv-issue' }, issue) : null,
      !revised && advice ? h('div', { className: 'nw-adv-why' }, advice) : null,
      why ? h('div', { className: 'nw-adv-why' }, why) : null,
      h(
        'div',
        { className: 'nw-adv-foot' },
        h('span', { className: 'nw-adv-kind' }, KIND[item.kind] || NW.t('表达')),
        h('span', { style: { flex: '1 1 auto' } }),
        canDecide && typeof p.onAccept === 'function'
          ? h(
              'button',
              {
                type: 'button',
                className: 'nw-adv-btn',
                'data-kind': 'accept',
                disabled: busy,
                onClick: (ev) => {
                  ev.stopPropagation();
                  p.onAccept(item);
                },
              },
              NW.t('接受'),
            )
          : null,
        canDecide && typeof p.onReject === 'function'
          ? h(
              'button',
              {
                type: 'button',
                className: 'nw-adv-btn',
                'data-kind': 'reject',
                disabled: busy,
                onClick: (ev) => {
                  ev.stopPropagation();
                  p.onReject(item);
                },
              },
              NW.t('拒绝'),
            )
          : null,
        !canDecide
          ? h(
              'span',
              { className: 'nw-adv-btn', 'data-kind': state === 'accepted' ? 'accept' : 'reject', 'aria-live': 'polite' },
              state === 'accepted' ? NW.t('已接受') : NW.t('已拒绝'),
            )
          : null,
        !canDecide && typeof p.onUndo === 'function'
          ? h(
              'button',
              {
                type: 'button',
                className: 'nw-adv-btn',
                disabled: busy,
                onClick: (ev) => {
                  ev.stopPropagation();
                  p.onUndo(item);
                },
              },
              NW.t('撤销'),
            )
          : null,
      ),
    );
  }

  /**
   * 已接收 — a collapsed directory under the new suggestions.
   *
   * Folded by default: the writer opened 修改建议 for the *new* read, and a list
   * of everything they ever accepted would push those off the top of the column.
   * Inside, records on the same stretch of text are bracketed together and
   * numbered, so 「这句改过一次」 is visible at a glance.
   */
  function AcceptedPanel(props) {
    const p = props || {};
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const [open, setOpen] = useState(false);
    const [activeId, setActiveId] = useState('');
    if (!rows.length) return null;
    const text = typeof p.getText === 'function' ? String(p.getText() || '') : '';
    const groups = groupRevisions(rows, text);
    return h(
      'div',
      { className: 'nw-accepted', 'data-open': open ? '1' : '0' },
      h(
        'button',
        {
          type: 'button',
          className: 'nw-accepted-head',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen((v) => !v),
        },
        h(
          'span',
          { className: 'nw-accepted-caret', 'aria-hidden': 'true' },
          NW.icon('chevright', { size: 12 }),
        ),
        h('span', null, NW.t('已接收')),
        h('span', { className: 'nw-suggest-count' }, String(rows.length) + ' 条'),
        h('span', { style: { flex: '1 1 auto' } }),
        groups.length > 1
          ? h('span', { className: 'nw-suggest-count' }, String(groups.length) + ' 处')
          : null,
      ),
      h(
        'div',
        { className: 'nw-accepted-body' },
        groups.map((grp, gi) =>
          h(
            'div',
            { className: 'nw-acc-group', key: 'g' + String(gi) },
            grp.rows.map((row, ri) =>
              h(
                'div',
                {
                  key: String(row.id),
                  className: 'nw-acc-row',
                  'data-active': activeId === String(row.id) ? '1' : '0',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => {
                    setActiveId(String(row.id));
                    if (typeof p.onReveal === 'function') p.onReveal(row);
                  },
                  onKeyDown: (ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    ev.preventDefault();
                    setActiveId(String(row.id));
                    if (typeof p.onReveal === 'function') p.onReveal(row);
                  },
                  title: row.found ? NW.t('点击定位到正文') : NW.t('原文已改动，定位可能不准'),
                },
                // The order badge only carries information when this region was
                // revised more than once; a single record needs no ①.
                grp.rows.length > 1
                  ? h('span', { className: 'nw-acc-ord' }, ordinalMark(ri))
                  : null,
                h(
                  'div',
                  { className: 'nw-acc-main' },
                  h('div', { className: 'nw-acc-quote' }, String(row.quote || '')),
                  row.revised ? h('div', { className: 'nw-acc-rev' }, String(row.revised)) : null,
                ),
                h('span', { className: 'nw-acc-meta' }, NW.fmtDate(row.createdAt)),
                // R93: 撤销接受 — deletes the record *and* puts the suggestion
                // back in the pending list. The old × only deleted it, so an
                // accepted card could never be reconsidered.
                typeof p.onUndo === 'function'
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'nw-acc-undo',
                        title: NW.t('撤销接受，把这条放回建议列表'),
                        'aria-label': NW.t('撤销接受'),
                        onClick: (ev) => {
                          ev.stopPropagation();
                          p.onUndo(row);
                        },
                      },
                      NW.t('撤销'),
                    )
                  : typeof p.onRemove === 'function'
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'nw-acc-drop',
                          title: NW.t('从已接收里删掉'),
                          'aria-label': NW.t('从已接收里删掉'),
                          onClick: (ev) => {
                            ev.stopPropagation();
                            p.onRemove(row);
                          },
                        },
                        '\u00d7',
                      )
                    : null,
              ),
            ),
          ),
        ),
      ),
    );
  }

  /**
   * 修改建议 (R12 ②) — an editorial column beside the manuscript.
   *
   * Deliberately not a dialog: the advice quotes a passage, and the writer has
   * to look at that passage to judge the advice. A modal covers exactly the text
   * being discussed. So this renders as a flex sibling of the editing surface
   * inside `.nw-bench`, with its own scrollbar.
   *
   * R73/R74 changed two things the writer asked for:
   *   - the 修改角度 chips are **optional and multi-select**. Nothing is selected
   *     by default; any number can be on at once ("节奏 + 用词" is a normal
   *     request), and leaving them all off means "just follow whatever I typed in
   *     the box" (and with no box either, a general read). Pressing a chip no
   *     longer fires a model call on its own — the run waits for the last press.
   *   - each suggestion can be 接受 or 拒绝. Accepted ones are remembered in
   *     IndexedDB and reappear folded under 已接收; rejected ones are never
   *     stored. Neither touches the manuscript — accepting records the decision,
   *     it does not rewrite the book.
   */
  function Advice(props) {
    const p = props || {};
    // R74: 角度是多选的. An empty array means "no angle picked" — the old `''`
    // could only carry one value, so picking a second angle silently dropped the
    // first, and 「只看节奏 + 用词」 was impossible to ask for.
    const [focus, setFocus] = useState([]);
    const focusRef = useRef(focus);
    focusRef.current = focus;
    const [note, setNote] = useState('');
    const [items, setItems] = useState(null);
    /** R90: the list was emptied by accepting/rejecting, not by a clean read. */
    const [drained, setDrained] = useState(false);
    /** R85: the paste box for advice written by another AI. */
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [pasteError, setPasteError] = useState('');
    const [busy, setBusy] = useState(false);
    /** R96: seconds the current read has been running — a reasoning model can
        think for minutes before its first card, and a silent panel looks dead. */
    const [elapsed, setElapsed] = useState(0);
    /** R96: cards received so far in the current stream. */
    const [streamCount, setStreamCount] = useState(0);
    const [error, setError] = useState('');
    const [activeId, setActiveId] = useState('');
    const [model, setModel] = useState('');
    /** item.id → 'accepted' | 'rejected' for the current read. */
    const [decided, setDecided] = useState({});
    /** R76: item.id → the span a 替换 created, so it can be undone. */
    const [applied, setApplied] = useState({});
    /** R76: the cards on screen came from the cache, not from a new model call. */
    const [fromCache, setFromCache] = useState(false);
    /** item.id → the stored row id, so 撤销 can remove exactly what it created. */
    const madeRef = useRef({});
    /** R85: imported cards survive a re-read; the model replaces only its own. */
    const itemsRef = useRef([]);
    itemsRef.current = Array.isArray(items) ? items : [];
    const [savingId, setSavingId] = useState('');
    const runRef = useRef(0);
    /** R91: the in-flight stream; closing the column or starting a re-read stops it. */
    const runAbortRef = useRef(null);
    const noteRef = useRef('');
    noteRef.current = note;
    /** R19 B2: pointer-drag on the left edge, mirrored from NW.Splitter. */
    const [dragging, setDragging] = useState(false);
    /* R25: p.width is null while the column is in auto mode; the drag starts from
       whatever the column currently measures, not from a hard-coded 336. */
    const widthRef = useRef(0);
    widthRef.current = Number(p.width) || 0;

    /* R91: unmounting the column must stop the model, not just hide the cards.
       Aborting the fetch closes the NDJSON response, and the host aborts the model
       stream on that close. */
    React.useEffect(
      () => () => {
        if (runAbortRef.current) {
          try {
            runAbortRef.current.abort();
          } catch {
            /* already aborted */
          }
        }
      },
      [],
    );

    /* R96: a live counter. The advice model may spend a minute or more thinking
       before it emits its first JSON object, and the panel used to sit on one
       static line for that whole time — indistinguishable from a hung request.
       A one-second tick proves the read is still alive. */
    React.useEffect(() => {
      if (!busy) {
        setElapsed(0);
        return undefined;
      }
      const started = Date.now();
      setElapsed(0);
      const timer = setInterval(() => {
        setElapsed(Math.max(1, Math.round((Date.now() - started) / 1000)));
      }, 1000);
      return () => clearInterval(timer);
    }, [busy]);

    React.useEffect(() => {
      if (!dragging) return undefined;
      const move = (ev) => {
        // The panel grows to the LEFT: its right edge is pinned to the bench.
        const panel = document.querySelector('.nw-suggest');
        const bench = panel && panel.parentElement;
        if (!bench) return;
        const box = bench.getBoundingClientRect();
        const next = Math.max(300, Math.min(640, box.right - ev.clientX));
        if (typeof p.onResize === 'function') p.onResize(Math.round(next));
      };
      const up = () => setDragging(false);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
    }, [dragging, p.onResize]);

    const chapterId = p.chapter ? String(p.chapter.id) : '';

    const run = useCallback(
      async (nextFocus, nextNote) => {
        const api = p.editorApi && p.editorApi.current;
        const text = api && typeof api.getContent === 'function' ? api.getContent() : '';
        if (!String(text).trim()) {
          setError('这一章还没有正文');
          return;
        }
        const token = runRef.current + 1;
        runRef.current = token;
        // R91: a re-read replaces the previous stream. Two model calls writing
        // into one column would interleave cards from different runs.
        if (runAbortRef.current) {
          try {
            runAbortRef.current.abort();
          } catch {
            /* already gone */
          }
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        runAbortRef.current = controller;
        setBusy(true);
        setStreamCount(0);
        setError('');
        setActiveId('');
        setFromCache(false);
        setDrained(false);
        const imported = itemsRef.current.filter((item) => String((item && item.id) || '').startsWith('p'));
        // Keep the writer's own pasted cards visible; the model's cards stream in
        // below them, one closing brace at a time.
        setItems(imported.length ? imported : null);
        const streamed = [];
        const focusIds = (Array.isArray(nextFocus) ? nextFocus : focusRef.current).join(',');
        // `undefined` rather than '' so a stale caller cannot wipe a note the
        // writer typed after pressing Enter.
        const note = nextNote == null ? noteRef.current : nextNote;
        // R29: this panel has its own model — the writer may want the editorial
        // read on a stronger model than the proofreader.
        const provider = (p.settings && p.settings.adviceProvider) || undefined;
        const model = (p.settings && p.settings.adviceModel) || undefined;
        try {
          let data = null;
          let streamFailure = null;
          if (NW.ai && typeof NW.ai.reviseStream === 'function') {
            try {
              data = await NW.ai.reviseStream(
                { text, focus: focusIds, note, provider, model },
                {
                  signal: controller ? controller.signal : undefined,
                  onEvent: (event) => {
                    if (runRef.current !== token) return;
                    if (!event || event.type !== 'suggestion' || !event.item) return;
                    streamed.push(event.item);
                    setStreamCount(streamed.length);
                    setItems(imported.concat(streamed));
                  },
                },
              );
            } catch (err) {
              if (runRef.current !== token) return;
              // An explicit cancel is not a failure: the writer closed the panel
              // or started another read, so there is nothing to report.
              if (err && err.code === 'aborted') return;
              streamFailure = err;
            }
          }
          if (!data && streamed.length) {
            // Half a loaf is still bread: keep what already arrived and say that
            // the rest is missing instead of throwing the cards away.
            data = { suggestions: streamed, model: '', partial: true };
            if (streamFailure) setError('流式读到一半断了，下面是收到的部分');
          }
          if (!data) {
            // The unary route is the one with model failover, so a dead default
            // model still ends with an answer instead of an error card.
            setItems(imported.length ? imported : null);
            data = await NW.ai.reviseSafe({
              text,
              focus: focusIds,
              note,
              provider,
              model,
              onRetry: (candidate) => {
                if (runRef.current === token) setError(NW.t('换用 {0} 重试…', candidate.label));
              },
            });
          }
          if (runRef.current !== token) return;
          const used = (data && data.usedModel) || null;
          if (used && typeof p.onToast === 'function') {
            const wantProvider = (p.settings && p.settings.adviceProvider) || '';
            const wantModel = (p.settings && p.settings.adviceModel) || '';
            if (wantProvider && wantModel && (used.provider !== wantProvider || used.model !== wantModel)) {
              p.onToast(NW.t('原模型没有响应，已改用 {0}', used.label), 'warn');
            }
          }
          if (used) setError('');
          const finalItems = streamed.length
            ? streamed
            : (Array.isArray(data && data.suggestions) ? data.suggestions : []);
          /* R85: a re-read replaces the model's cards, not the writer's paste.
             Imported ids start with `p`, and that prefix is the whole rule. */
          const merged = imported.concat(finalItems);
          setItems(merged);
          setModel(String((data && data.model) || ''));
          // R76: remember this read so closing and reopening the column does not
          // silently bill the same chapter twice.
          if (merged.length) {
            cachePut('dock|' + chapterId, {
              items: merged,
              model: String((data && data.model) || ''),
              fp: textFingerprint(text),
              at: Date.now(),
            });
          } else {
            // R91: a clean "nothing to flag" answer must clear yesterday's cache,
            // or reopening the column resurrects cards the model just withdrew.
            cacheDel('dock|' + chapterId);
          }
        } catch (err) {
          if (runRef.current !== token) return;
          if (err && err.code === 'aborted') return;
          const keep = imported.concat(streamed);
          setItems(keep.length ? keep : null);
          setError(errText(err, '获取修改建议失败'));
        } finally {
          if (runRef.current === token) setBusy(false);
          if (runAbortRef.current === controller) runAbortRef.current = null;
        }
      },
      // R74: `focus` is deliberately absent — the payload is read from
      // `focusRef` at call time, so a chip press does not rebuild the whole
      // callback (and, more importantly, does not capture yesterday's set).
      // R76: `chapterId` joined the list because the result is cached per chapter.
      [chapterId, p.editorApi, p.settings],
    );

    /**
     * R85: take a paste from another AI and put it in the same list as the
     * model's own cards. The parser returns the host's suggestion shape, so
     * from here on nothing in the panel needs to know where a card came from:
     * 高亮、接受、拒绝、复制、替换、撤销 all read the same fields.
     *
     * Imported cards are appended rather than replacing the current read —
     * a writer comparing two models wants both in front of them. Ids get a
     * timestamp prefix so they cannot collide with the model's `r1…r8`, and a
     * card whose quote is no longer in the chapter is kept with `start:-1`
     * (the panel already explains that state).
     */
    const importPaste = useCallback(() => {
      const parser = NW.advicePaste;
      if (!parser) {
        setPasteError('粘贴导入没有加载');
        return;
      }
      const api = p.editorApi && p.editorApi.current;
      const text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
      const parsed = parser.parse(pasteText, text);
      if (!parsed.ok) {
        setPasteError(parsed.error);
        return;
      }
      const base = Array.isArray(items) ? items : [];
      const seen = new Set(base.map((item) => String(item.quote || '') + '|' + String(item.issue || '')));
      const stamp = Date.now().toString(36);
      const additions = [];
      parsed.items.forEach((item, index) => {
        const key = item.quote + '|' + item.issue;
        if (seen.has(key)) return;
        seen.add(key);
        additions.push(Object.assign({}, item, { id: 'p' + stamp + index }));
      });
      if (!additions.length) {
        setPasteError('这些建议已经在列表里了');
        return;
      }
      const merged = base.concat(additions);
      setItems(merged);
      setDrained(false);
      setModel('');
      setFromCache(false);
      cachePut('dock|' + chapterId, {
        items: merged,
        model: '',
        fp: textFingerprint(text),
        at: Date.now(),
      });
      setPasteError('');
      setPasteOpen(false);
      setPasteText('');
      if (typeof p.onToast === 'function') {
        const tail = parsed.unlocated ? ' · ' + NW.t('{0} 条没定位到原文', parsed.unlocated) : '';
        p.onToast(NW.t('已导入 {0} 条建议', additions.length) + tail, 'ok');
      }
    }, [items, pasteText, chapterId, p.onToast]);

    /**
     * R86: the default copy is the whole briefing — format, the chapter's full
     * text, and every issue already in the column. The other model then sees
     * both the context and what the writer has already been told, so its answer
     * can skip straight back into the paste box.
     */
    const copyFullPrompt = useCallback(() => {
      const parser = NW.advicePaste;
      if (!parser || typeof parser.buildPrompt !== 'function') {
        // A stale client (page not refreshed after an update) has no parser.
        // Returning silently here is how "点了没反应" used to happen.
        if (typeof p.onToast === 'function') p.onToast(NW.t('复制组件没有加载，请刷新页面后再试'), 'warn');
        return;
      }
      let text = '';
      try {
        const api = p.editorApi && p.editorApi.current;
        text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(NW.t('读不到当前章节，请刷新页面后再试'), 'warn');
        return;
      }
      const list = Array.isArray(items) ? items : [];
      copyToClipboard(parser.buildPrompt(text, list)).then((ok) => {
        if (typeof p.onToast !== 'function') return;
        p.onToast(
          ok
            ? NW.t('已复制全文（{0} 字）和 {1} 条问题', text.length, list.length)
            : NW.t('复制失败，请手动选中'),
          ok ? 'ok' : 'warn',
        );
      });
    }, [items, p.editorApi, p.onToast]);

    /**
     * R75: a chip press only changes the selection — it must never start a read.
     *
     * R74 tried to be clever and fired the request 420ms after the last press.
     * The writer presses 「节奏」, thinks for a second about 「用词」, and the 420ms
     * has long passed: the chapter is already being read, the chips are disabled,
     * and the second angle can no longer be added. That is the exact complaint
     * that killed the round. So the run now happens only where it is asked for —
     * 「开始审读」, 「重新审读」, 「重试」 and Enter.
     */

    // A fresh chapter starts blank: advice about the previous one is worse than
    // no advice, because it quotes text that is no longer on screen.
    React.useEffect(() => {
      setItems(null);
      setError('');
      setActiveId('');
      setBusy(false);
      setDecided({});
      setApplied({});
      setFromCache(false);
      setDrained(false);
      madeRef.current = {};
      runRef.current += 1;
      // R76: reopening the column on an unchanged chapter shows the last read
      // instead of an empty panel that costs another call to refill.
      //
      // R93: after a page/plugin reload the panel can mount before the editor
      // has hydrated, so `getContent()` is momentarily empty. Fall back to the
      // chapter row (already loaded from IndexedDB) — otherwise the persistent
      // cache exists but is never read, which is exactly the "建议消失了" bug.
      const api = p.editorApi && p.editorApi.current;
      let text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
      if (!text && p.chapter && typeof p.chapter.content === 'string') text = p.chapter.content;
      const hit = text ? cacheGet('dock|' + chapterId) : null;
      if (hit && hit.fp === textFingerprint(text) && Array.isArray(hit.items) && hit.items.length) {
        setItems(hit.items);
        setModel(String(hit.model || ''));
        setFromCache(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chapterId]);

    const reveal = useCallback(
      (item) => {
        setActiveId(item.id);
        const api = p.editorApi && p.editorApi.current;
        if (!api) return;
        if (Number(item.start) >= 0 && typeof api.setHighlights === 'function') {
          api.setHighlights([{ start: Number(item.start), end: Number(item.end), id: item.id, active: true }]);
          // R23: the quoted sentence is put on the same horizontal band as the
          // suggestion that talks about it — both sit at the vertical middle of
          // the screen, so the eye can jump left/right without moving up or
          // down. An exact offset measurement replaces the old
          // getScrollRatio/scrollTo guess, which landed wherever the ratio
          // happened to point.
          if (typeof api.centerRange === 'function') {
            api.centerRange(Number(item.start), Number(item.end));
          } else if (typeof api.scrollTo === 'function' && typeof api.getScrollRatio === 'function') {
            const ratio = p.chapter && p.chapter.content
              ? clampRatio(Number(item.start) / Math.max(1, String(p.chapter.content).length))
              : 0;
            api.scrollTo(ratio);
          }
        }
        // Mirror of the above on the panel side: the card that is being read
        // slides to the middle of the *viewport* — the same band the highlighted
        // sentence landed on. `scrollIntoView({block:'center'})` centres it in
        // the scrolling body instead, which sits below the panel header and the
        // focus chips, so the pair ended up ~60px apart.
        window.setTimeout(() => {
          // R73: the cards are `.nw-adv` now; the old `.nw-advice` selector is
          // kept so a stale panel from an older build still lines up.
          const node = document.querySelector('.nw-adv[data-active="1"], .nw-advice[data-active="1"]');
          const body = document.querySelector('.nw-suggest-body');
          if (!node || !body) return;
          // Both sides are measured against the same line: the vertical middle
          // of the manuscript pane. Using the window middle instead left the
          // pair half a line apart, because the status bar eats the bottom
          // 34px of the viewport.
          const pane = document.querySelector('.nw-scroll');
          const paneRect = pane ? pane.getBoundingClientRect() : null;
          const band = paneRect
            ? paneRect.top + paneRect.height / 2
            : (window.innerHeight || document.documentElement.clientHeight || 0) / 2;
          const cardRect = node.getBoundingClientRect();
          body.scrollTop += cardRect.top + cardRect.height / 2 - band;
        }, 0);
      },
      [p.editorApi, p.chapter],
    );

    const clearHighlights = useCallback(() => {
      const api = p.editorApi && p.editorApi.current;
      if (api && typeof api.setHighlights === 'function') api.setHighlights([]);
      setActiveId('');
    }, [p.editorApi]);

    React.useEffect(() => () => {
      // Unmounting the column must not leave stale highlights on the paper.
      const api = p.editorApi && p.editorApi.current;
      if (api && typeof api.setHighlights === 'function') api.setHighlights([]);
    }, [p.editorApi]);

    /**
     * R90: a decided card leaves the pending list. Accepting also writes a row,
     * so the suggestion reappears under 已接收; rejecting keeps nothing. The read
     * cache is rewritten in the same step — otherwise closing and reopening the
     * column would restore the card from cache and undo the writer's decision.
     */
    const dropItem = useCallback(
      (item) => {
        if (!item || item.id == null) return;
        const id = String(item.id);
        const base = Array.isArray(itemsRef.current) ? itemsRef.current : [];
        const remainder = base.filter((entry) => String(entry.id) !== id);
        setItems(remainder);
        setDrained(remainder.length === 0);
        setDecided((prev) => {
          if (!prev[id]) return prev;
          const next = Object.assign({}, prev);
          delete next[id];
          return next;
        });
        if (activeId === id) clearHighlights();
        const key = 'dock|' + chapterId;
        if (!remainder.length) {
          cacheDel(key);
          return;
        }
        const api = p.editorApi && p.editorApi.current;
        const text =
          api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        cachePut(key, {
          items: remainder,
          model: model,
          fp: textFingerprint(text),
          at: Date.now(),
        });
      },
      [activeId, chapterId, clearHighlights, model, p.editorApi],
    );

    // R73: no 全部 chip and nothing preselected. "No angle" means the read is
    // driven by what the writer typed in the box, which is what they asked for.
    const FOCUS_OPTIONS = [
      { value: 'rhythm', label: '节奏' },
      { value: 'diction', label: '用词' },
      { value: 'pov', label: '视角' },
      { value: 'detail', label: '画面' },
      { value: 'dialogue', label: '对话' },
      { value: 'structure', label: '结构' },
      { value: 'character', label: '人物' },
      { value: 'logic', label: '逻辑' },
      { value: 'emotion', label: '情绪' },
      { value: 'redundancy', label: '冗余' },
    ];

    // ---- 接受 / 拒绝 / 撤销 (R73) -------------------------------------------
    // Accepting writes one row to IndexedDB and nothing else: the manuscript is
    // the writer's, and a suggestion is a proposal. Rejecting writes nothing at
    // all — a "no" is not history worth keeping.
    const acceptItem = useCallback(
      async (item) => {
        if (!item || !chapterId || typeof p.onAccept !== 'function') return;
        setDecided((prev) => Object.assign({}, prev, { [item.id]: 'accepted' }));
        setSavingId(item.id);
        try {
          const row = await p.onAccept({
            quote: item.quote,
            // In the dock's card the rewrite lives in `example`; that IS the
            // 改后 text, so it is what gets stored.
            revised: String(item.example || item.revised || ''),
            issue: item.issue,
            why: item.why,
            advice: item.advice,
            kind: item.kind,
            severity: item.severity,
            start: item.start,
            end: item.end,
            source: 'chapter',
          });
          if (row && row.id) {
            madeRef.current = Object.assign({}, madeRef.current, { [item.id]: String(row.id) });
            // R90: the card moves to 已接收 instead of lingering in the list.
            dropItem(item);
          }
        } catch (err) {
          // The row did not land: the card must not claim it did.
          setDecided((prev) => {
            const next = Object.assign({}, prev);
            delete next[item.id];
            return next;
          });
        } finally {
          setSavingId('');
        }
      },
      [chapterId, dropItem, p.onAccept],
    );

    const rejectItem = useCallback(
      (item) => {
        if (!item) return;
        // R90: a rejected suggestion is discarded on the spot — no history row,
        // no card left behind waiting for an undo.
        dropItem(item);
      },
      [dropItem],
    );

    const undoItem = useCallback(
      async (item) => {
        if (!item) return;
        const was = decided[item.id];
        const rowId = madeRef.current[item.id];
        setDecided((prev) => {
          const next = Object.assign({}, prev);
          delete next[item.id];
          return next;
        });
        if (rowId) {
          const rest = Object.assign({}, madeRef.current);
          delete rest[item.id];
          madeRef.current = rest;
        }
        // Undoing an accept must remove the row too, otherwise 已接收 keeps a
        // record of a decision the writer just took back.
        if (was === 'accepted' && rowId && typeof p.onRemoveAccepted === 'function') {
          try {
            await p.onRemoveAccepted({ id: rowId });
          } catch (err) {
            /* the list refreshes from the store; a failure leaves it honest */
          }
        }
      },
      [decided, p.onRemoveAccepted],
    );

    /** Accepted rows are located against the live buffer, not the saved one. */
    const revealRow = useCallback(
      (row) => {
        const api = p.editorApi && p.editorApi.current;
        if (!api || !row) return;
        const text = typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        const span = locateRevision(row, text);
        if (span.start < 0) return;
        if (typeof api.setHighlights === 'function') {
          api.setHighlights([{ start: span.start, end: span.end, id: row.id, active: true }]);
        }
        if (typeof api.centerRange === 'function') api.centerRange(span.start, span.end);
      },
      [p.editorApi],
    );

    /**
     * R93: 撤销接受 — the reverse of `acceptItem`.
     *
     * Deletes the IndexedDB record, then rebuilds the card from that record and
     * puts it back at the top of the pending list. The id gets an `a` prefix so
     * it can never collide with a model card (`r1…r8`) or a paste (`p…`); the
     * cache is rewritten in the same step, otherwise a reload would resurrect
     * the old state.
     */
    const undoAccepted = useCallback(
      async (row) => {
        if (!row || row.id == null) return;
        if (typeof p.onRemoveAccepted === 'function') {
          try {
            await p.onRemoveAccepted({ id: row.id });
          } catch (err) {
            if (typeof p.onToast === 'function') p.onToast(NW.t('撤销失败，请重试'), 'warn');
            return;
          }
        }
        const api = p.editorApi && p.editorApi.current;
        const text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        const quote = String(row.quote || '');
        const at = quote ? text.indexOf(quote) : -1;
        const item = {
          id: 'a' + String(row.id),
          quote,
          issue: row.issue,
          why: row.why,
          advice: row.advice,
          example: String(row.revised || ''),
          revised: String(row.revised || ''),
          kind: row.kind,
          severity: row.severity,
          start: at,
          end: at >= 0 ? at + quote.length : -1,
          restored: true,
        };
        const base = Array.isArray(itemsRef.current) ? itemsRef.current.slice() : [];
        if (!base.some((entry) => String(entry && entry.id) === item.id)) base.unshift(item);
        setItems(base);
        setDrained(false);
        setDecided((prev) => {
          const next = Object.assign({}, prev);
          delete next[item.id];
          return next;
        });
        cachePut('dock|' + chapterId, {
          items: base,
          model: model,
          fp: textFingerprint(text),
          at: Date.now(),
        });
        setActiveId(item.id);
        if (typeof p.onToast === 'function') p.onToast(NW.t('已撤销接受，建议回到列表'), 'ok');
      },
      [chapterId, model, p.editorApi, p.onRemoveAccepted, p.onToast],
    );

    // ---- R76: 复制 / 替换 / 撤销替换 -----------------------------------------
    // Same contract as the selection window: 接受 still only records a decision,
    // 替换 is an explicit second click that writes and can be undone while that
    // span still holds what we wrote.
    const copyItem = useCallback(
      (item) => {
        const value = String((item && (item.revised || item.example)) || '');
        if (!value) return;
        copyToClipboard(value).then((ok) => {
          if (typeof p.onToast === 'function') {
            p.onToast(ok ? NW.t('改后已经复制') : NW.t('复制失败，请手动选中'), ok ? 'ok' : 'warn');
          }
        });
      },
      [p.onToast],
    );

    const applyItem = useCallback(
      (item) => {
        const api = p.editorApi && p.editorApi.current;
        if (!api || !item || typeof api.replaceRange !== 'function') return;
        const revised = String(item.revised || item.example || '');
        if (!revised) return;
        const text = typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        const quote = String(item.quote || '');
        let s = Number(item.start);
        let e = Number(item.end);
        if (!(s >= 0 && e > s && text.slice(s, e) === quote)) {
          const at = quote ? text.indexOf(quote) : -1;
          if (at < 0) {
            if (typeof p.onToast === 'function') p.onToast(NW.t('原文已经改动，替换不了这一处'), 'warn');
            return;
          }
          s = at;
          e = at + quote.length;
        }
        api.replaceRange(s, e, revised);
        setApplied((prev) =>
          Object.assign({}, prev, { [item.id]: { start: s, end: s + revised.length, before: quote, after: revised } }),
        );
        if (typeof p.onToast === 'function') p.onToast(NW.t('已替换，可以撤销'), 'ok');
      },
      [p.editorApi, p.onToast],
    );

    const undoApply = useCallback(
      (item) => {
        if (!item) return;
        const rec = applied[item.id];
        const api = p.editorApi && p.editorApi.current;
        if (!rec || !api || typeof api.replaceRange !== 'function') return;
        const text = typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        if (text.slice(rec.start, rec.end) !== rec.after) {
          if (typeof p.onToast === 'function') p.onToast(NW.t('正文已经改过，这一处撤销不了'), 'warn');
          return;
        }
        api.replaceRange(rec.start, rec.end, rec.before);
        setApplied((prev) => {
          const next = Object.assign({}, prev);
          delete next[item.id];
          return next;
        });
        if (typeof p.onToast === 'function') p.onToast(NW.t('已撤销替换'), 'ok');
      },
      [applied, p.editorApi, p.onToast],
    );

    // R77 (B3): 键盘 —— J/K 上下、A 接受、R 拒绝。输入框/文本域里不抢键。
    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.defaultPrevented) return;
        const target = ev.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        // R82: a <select> uses the arrow keys, a focused button uses Space/Enter,
        // and a dialog on top owns the keyboard. None of them should scroll the
        // manuscript or accept advice behind the overlay.
        if (target && (target.tagName === 'SELECT' || target.tagName === 'BUTTON')) return;
        if (target && typeof target.closest === 'function' && target.closest('.nw-modal-mask')) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return;
        const at = list.findIndex((row) => row.id === activeId);
        const pick = (index) => list[Math.max(0, Math.min(list.length - 1, index))];
        const key = String(ev.key || '');
        if (key === 'j' || key === 'J' || key === 'ArrowDown') {
          ev.preventDefault();
          reveal(pick(at < 0 ? 0 : at + 1));
          return;
        }
        if (key === 'k' || key === 'K' || key === 'ArrowUp') {
          ev.preventDefault();
          reveal(pick(at < 0 ? 0 : at - 1));
          return;
        }
        const current = at >= 0 ? list[at] : null;
        if (!current) return;
        if (key === 'a' || key === 'A') {
          ev.preventDefault();
          acceptItem(current);
          return;
        }
        if (key === 'r' || key === 'R') {
          ev.preventDefault();
          rejectItem(current);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [items, activeId, reveal, acceptItem, rejectItem]);

    const head = h(
      'div',
      { className: 'nw-suggest-head' },
      h('span', { className: 'nw-suggest-title' }, NW.t('修改建议')),
      items && items.length > 0 ? h('span', { className: 'nw-suggest-count' }, items.length + ' 条') : null,
      h('span', { style: { flex: '1 1 auto' } }),
      NW.ui.iconBtn(
        NW.icon('x', { size: 16 }),
        NW.t('关闭建议'),
        () => {
          clearHighlights();
          p.onClose();
        },
      ),
    );

    // Focus chips (R74/R75): a real multi-select. Any number can be on at once —
    // 「只看节奏 + 用词」 is a perfectly normal request — and clicking a lit one
    // removes just that one. A press changes nothing but the selection: the read
    // starts from 「开始审读」 (see the R75 note above), so the writer can line up
    // three angles at their own pace.
    const focusRow = h(
      'div',
      { className: 'nw-advice-focus', role: 'group', 'aria-label': NW.t('建议重点') },
      FOCUS_OPTIONS.map((opt) => {
        const on = focus.indexOf(opt.value) >= 0;
        return h(
          'button',
          {
            key: opt.value,
            type: 'button',
            className: 'nw-advice-chip',
            'data-on': on ? '1' : '0',
            'aria-pressed': on ? 'true' : 'false',
            disabled: busy,
            title: on ? NW.t('再点一次取消') : NW.t('加上这个角度（可多选）'),
            onClick: () => {
              const next = on
                ? focus.filter((value) => value !== opt.value)
                : focus.concat([opt.value]);
              // R75: selection only. Starting the read from here is what made
              // the second angle impossible to add.
              setFocus(next);
            },
          },
          opt.label,
        );
      }),
      // R74: says out loud that the chips are optional *and* multi-select — the
      // writer asked for both, and ten unlit pills read as "nothing works".
      // R75: and it says what to do next, now that pressing a pill does not run.
      h(
        'span',
        { className: 'nw-advice-focus-hint' },
        focus.length
          ? NW.t('已选 {0} 个角度 · 再点一次取消，选好后点下方按钮', focus.length)
          : NW.t('角度可多选、也可以不选 · 不选就按下面的要求来'),
      ),
    );

    // Free-text instruction. Enter submits (Shift+Enter inserts a newline) so the
    // common case is type → Enter → new advice, without moving the hand.
    const noteBox = h(
      'div',
      { className: 'nw-advice-note' },
      h('textarea', {
        value: note,
        rows: 2,
        placeholder: NW.t('补充要求，例如：只看结尾三段 / 别动对话 / 主角口吻再冷一点'),
        'aria-label': NW.t('补充要求'),
        onChange: (ev) => setNote(ev.target.value),
        onKeyDown: (ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            run(focus, ev.currentTarget.value);
          }
        },
      }),
      h(
        'div',
        { className: 'nw-advice-notebar' },
        h('span', { className: 'nw-advice-notehint' }, NW.t('Enter 按这个要求重来')),
        h('span', { style: { flex: '1 1 auto' } }),
        h(
          'button',
          {
            type: 'button',
            className: 'nw-advice-paste-toggle',
            'aria-expanded': pasteOpen ? 'true' : 'false',
            onClick: () => {
              setPasteOpen((open) => !open);
              setPasteError('');
            },
          },
          pasteOpen ? NW.t('收起粘贴') : NW.t('粘贴其他 AI 的建议'),
        ),
        note
          ? NW.ui.btn({
              kind: 'ghost',
              onClick: () => setNote(''),
              children: NW.t('清空'),
            })
          : null,
      ),
    );

    /**
     * R85/R87: a paste box that produces the same cards as a model read.
     *
     * The panel is framed as a small import card: a title row, the format block
     * (which doubles as the prompt), one copy button, then the textarea. R87
     * removed the 「只复制格式」 button — the format block itself is still
     * selectable, and two copy buttons only made the primary one ambiguous.
     */
    const pastePanel = pasteOpen
      ? h(
          'div',
          { className: 'nw-advice-paste', role: 'region', 'aria-label': NW.t('粘贴其他 AI 的建议') },
          h(
            'div',
            { className: 'nw-advice-paste-head' },
            h('span', { className: 'nw-advice-paste-icon', 'aria-hidden': 'true' }, NW.icon('sparkle', { size: 14 })),
            h('strong', { className: 'nw-advice-paste-title' }, NW.t('粘贴其他 AI 的建议')),
            h('span', { className: 'nw-advice-paste-tag' }, NW.t('与模型建议同一套卡片')),
            h(
              'button',
              {
                type: 'button',
                className: 'nw-advice-paste-close',
                'aria-label': NW.t('关闭粘贴面板'),
                title: NW.t('关闭'),
                onClick: () => {
                  setPasteOpen(false);
                  setPasteText('');
                  setPasteError('');
                },
              },
              '×',
            ),
          ),
          h(
            'div',
            { className: 'nw-advice-paste-help' },
            NW.t('把另一个 AI 写好的建议贴进来。点「复制全文与全部问题」会把本章全文和已有建议一起复制，直接发给对方；原文要和这一章一字不差，卡片才能定位和高亮。'),
          ),
          h(
            'div',
            { className: 'nw-advice-paste-fmtbox' },
            h(
              'div',
              { className: 'nw-advice-paste-fmtlabel' },
              h('span', null, NW.t('格式说明')),
              h('span', { className: 'nw-advice-paste-fmtnote' }, NW.t('可直接整段复制给 AI')),
            ),
            h('pre', { className: 'nw-advice-paste-fmt' }, NW.advicePaste ? NW.advicePaste.TEMPLATE : ''),
          ),
          h(
            'div',
            { className: 'nw-advice-paste-tools' },
            NW.ui.btn({
              kind: 'ghost',
              className: 'nw-advice-paste-copy',
              onClick: copyFullPrompt,
              children: NW.t('复制全文与全部问题'),
            }),
            h('span', { className: 'nw-advice-paste-tip' }, NW.t('也可以直接贴 JSON 数组')),
          ),
          h('textarea', {
            className: 'nw-advice-paste-input',
            value: pasteText,
            rows: 6,
            spellCheck: false,
            placeholder: NW.t('原文：……\n问题：……\n建议：……'),
            'aria-label': NW.t('粘贴其他 AI 的建议'),
            onChange: (ev) => {
              setPasteText(ev.target.value);
              if (pasteError) setPasteError('');
            },
            onKeyDown: (ev) => {
              if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                importPaste();
              }
            },
          }),
          h(
            'div',
            { className: 'nw-advice-paste-meta' },
            h(
              'span',
              { className: 'nw-advice-paste-count' },
              pasteText
                ? NW.t('已输入 {0} 字', String(pasteText).length)
                : NW.t('支持标签格式或 JSON 数组'),
            ),
            h('span', { className: 'nw-advice-paste-actions-hint' }, NW.t('Ctrl+Enter 导入')),
          ),
          pasteError ? h('div', { className: 'nw-advice-paste-error', role: 'alert' }, pasteError) : null,
          h(
            'div',
            { className: 'nw-advice-paste-actions' },
            NW.ui.btn({
              kind: 'primary',
              disabled: !String(pasteText).trim(),
              onClick: importPaste,
              children: NW.t('导入到建议栏'),
            }),
            NW.ui.btn({
              kind: 'ghost',
              onClick: () => {
                setPasteOpen(false);
                setPasteText('');
                setPasteError('');
              },
              children: NW.t('取消'),
            }),
          ),
        )
      : null;

    let body;
    /* R91: once the first card has streamed in, the list stays on screen and the
       waiting card becomes a small footer — a full-screen spinner would hide the
       very cards that make streaming feel fast. */
    const hasCards = Array.isArray(items) && items.length > 0;
    if (busy && !hasCards) {
      body = h(
        'div',
        { className: 'nw-suggest-empty' },
        NW.ui.spinner(),
        h('span', null, NW.t('正在读这一章…')),
        h('span', { style: { fontSize: '12px', opacity: '.7' } }, NW.t('模型要通读全文，通常十几秒。')),
      );
    } else if (error) {
      body = h(
        'div',
        { className: 'nw-suggest-empty' },
        h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, error),
        NW.ui.btn({ kind: 'primary', onClick: () => run(focus), children: NW.t('重试') }),
      );
    } else if (!items) {
      body = h(
        'div',
        { className: 'nw-suggest-empty' },
        NW.icon('sparkle', { size: 24 }),
        h('span', null, NW.t('让模型通读这一章，指出最值得改的地方。')),
        h(
          'span',
          { style: { fontSize: '12px', opacity: '.7' } },
          NW.t('接受会移到下面的「已接收」，拒绝的直接丢掉；点一条会把原文滚到那一段。'),
        ),
        busy
          ? h(
              'span',
              { className: 'nw-inline' },
              NW.ui.spinner(),
              // R96: prove the read is alive. A reasoning model can think for
              // minutes before the first card; a frozen "正在通读" looked like a
              // dead request.
              h(
                'span',
                null,
                streamCount > 0
                  ? NW.t('已读到 {0} 条，继续往下读… {1}s', streamCount, elapsed)
                  : elapsed >= 20
                    ? NW.t('模型正在思考… {0}s', elapsed)
                    : NW.t('正在通读这一章… {0}s', elapsed),
              ),
            )
          : NW.ui.btn({ kind: 'primary', onClick: () => run(focus), children: NW.t('开始审读') }),
      );
    } else if (items.length === 0) {
      body = h(
        'div',
        { className: 'nw-suggest-empty' },
        NW.icon('success', { size: 24 }),
        h(
          'span',
          null,
          NW.t(drained ? '这些建议都处理完了。' : '这一章没有被标出的明显问题。'),
        ),
        h(
          'span',
          { style: { fontSize: '12px', opacity: '.7' } },
          NW.t(drained ? '重新审读可以再找一轮，或者回去接着写。' : '换个重点再看看，或写下去。'),
        ),
        // R93: 重新审读 must be here whether the list was drained or the model
        // found nothing — a writer staring at "没有问题" still needs a way to
        // ask again without closing the column.
        NW.ui.btn({
          kind: drained ? 'ghost' : 'primary',
          onClick: () => run(focus),
          disabled: busy,
          children: NW.t('重新审读'),
        }),
      );
    } else {
      body = h(
        'div',
        { className: 'nw-suggest-body' },
        items.map((item) =>
          h(AdviceCard, {
            key: item.id,
            item: item,
            state: decided[item.id] || 'pending',
            active: activeId === item.id,
            busy: savingId === item.id,
            applied: !!applied[item.id],
            onReveal: Number(item.start) >= 0 ? () => reveal(item) : null,
            onAccept: acceptItem,
            onReject: rejectItem,
            onUndo: undoItem,
            onCopy: copyItem,
            onApply: applyItem,
            onUndoApply: undoApply,
          }),
        ),
        items.some((item) => Number(item.start) < 0)
          ? h(
              'div',
              { className: 'nw-advice-notehint' },
              NW.t('「原文已改动，定位不到」：那段文字已经不在这一章里了。'),
            )
          : null,
        busy
          ? h(
              'div',
              { className: 'nw-suggest-reading' },
              NW.ui.spinner(),
              h('span', null, NW.t('还在往下读… 已 {0} 条 · {1}s', streamCount, elapsed)),
            )
          : null,
      );
    }

    const foot =
      items && items.length > 0
        ? h(
            'div',
            { className: 'nw-suggest-foot' },
            NW.ui.btn({ onClick: () => run(focus), disabled: busy, children: NW.t('重新审读') }),
            clearHighlights && activeId ? NW.ui.btn({ kind: 'ghost', onClick: clearHighlights, children: NW.t('取消高亮') }) : null,
            // R76: the column can reopen with the last read already in it; say
            // so, or the writer will wonder where the results came from.
            fromCache ? h('span', { className: 'nw-suggest-cached' }, NW.t('上次的结果 · 没有重新计费')) : null,
            model ? h('span', { style: { fontSize: '11px', opacity: '.65', marginLeft: 'auto' } }, model) : null,
          )
        : null;

    // R19 B2: the grip is a real button so the column can also be resized with
    // the keyboard (left/right = ±16px), matching the shelf splitter.
    const grip = h('button', {
      type: 'button',
      className: 'nw-suggest-grip',
      'data-drag': dragging ? '1' : '0',
      'aria-label': NW.t('调整建议栏宽度'),
      tabIndex: 0,
      onPointerDown: (ev) => {
        ev.preventDefault();
        setDragging(true);
      },
      onKeyDown: (ev) => {
        if (typeof p.onResize !== 'function') return;
        /* R25: a double-click or Home puts the column back into auto mode. The
           grip used to be write-only — once dragged there was no way back to
           "hug the page". */
        if (ev.key === 'Home') {
          ev.preventDefault();
          p.onResize(null);
          return;
        }
        const step = ev.key === 'ArrowLeft' ? 16 : ev.key === 'ArrowRight' ? -16 : 0;
        if (!step) return;
        ev.preventDefault();
        /* R25: keyboard resize needs a starting number even in auto mode, so
           measure the column before nudging it. */
        const panel = document.querySelector('.nw-suggest');
        const base = widthRef.current || (panel ? Math.round(panel.getBoundingClientRect().width) : 336);
        p.onResize(clampNum(base + step, 300, 640));
      },
      onDoubleClick: () => {
        if (typeof p.onResize === 'function') p.onResize(null);
      },
      title: NW.t('拖拽调整建议栏宽度（双击回到自动）'),
    });

    return h(
      'aside',
      {
        className: 'nw-suggest',
        'aria-label': NW.t('修改建议'),
        /* R25: no inline width in auto mode — the CSS clamp measures the bench.
           An inline width only exists once the writer has dragged the grip. */
        style: Number(p.width) > 0 ? { width: clampNum(Number(p.width), 300, 640) + 'px' } : null,
        'data-manual': Number(p.width) > 0 ? '1' : '0',
      },
      grip,
      head,
      focusRow,
      noteBox,
      pastePanel,
      // R73: 已接收 sits under whatever the column is currently showing — the
      // new read, the busy state or the empty state. It is the same store the
      // selection window reads, so a decision made in one place is in both.
      h(
        'div',
        { className: 'nw-suggest-main' },
        body,
        h(
          'div',
          { className: 'nw-suggest-acceptedwrap' },
          h(AcceptedPanel, {
            rows: p.accepted,
            getText: () => {
              const api = p.editorApi && p.editorApi.current;
              return api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
            },
            onReveal: revealRow,
            onRemove: p.onRemoveAccepted,
            // R93: only the dock can put a card back into its own pending list.
            onUndo: typeof p.onRemoveAccepted === 'function' ? undoAccepted : undefined,
          }),
        ),
      ),
      foot,
    );
  }

  /**
   * 选中改写 (R73) — the window the little 修改建议 button opens.
   *
   * A window *beside* the manuscript, not a dialog on top of it: every card
   * compares 原文 with 改后, and the writer has to keep both in view while
   * deciding. It is a flex sibling of the paper inside `.nw-bench`, so opening
   * it squeezes the text column instead of covering it.
   *
   * Deliberately opinionated about scope: no model picker, no 修改角度 chips, no
   * note box. The writer already said what they want by selecting those words;
   * a second form would only ask them to say it again.
   */
  function SelectionAdvice(props) {
    const p = props || {};
    const chapterId = p.chapter ? String(p.chapter.id) : '';
    const selection = p.selection || {};
    const selStart = Math.max(0, Number(selection.start) || 0);
    const selEnd = Math.max(selStart, Number(selection.end) || 0);
    const [items, setItems] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [activeId, setActiveId] = useState('');
    const [decided, setDecided] = useState({});
    const [savingId, setSavingId] = useState('');
    const [model, setModel] = useState('');
    /** R76: which take these cards are (1 = first read, 2+ = 再改一版). */
    const [variant, setVariant] = useState(1);
    /** R76: shows this read came from the local cache, not a new model call. */
    const [fromCache, setFromCache] = useState(false);
    /** R76: applied replacements, by item id → the span to undo. */
    const [applied, setApplied] = useState({});
    const variantRef = useRef(1);
    const madeRef = useRef({});
    const runRef = useRef(0);
    /** R81: the in-flight stream. Closing the window aborts the host's model call. */
    const abortRef = useRef(null);

    React.useEffect(
      () => () => {
        if (abortRef.current) {
          try {
            abortRef.current.abort();
          } catch (err) {
            /* already gone */
          }
          abortRef.current = null;
        }
      },
      [],
    );

    const getText = useCallback(() => {
      const api = p.editorApi && p.editorApi.current;
      return api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
    }, [p.editorApi]);

    const cacheKeyFor = useCallback(
      (source) => `sel|${chapterId}|${selStart}|${selEnd}|${textFingerprint(source)}`,
      [chapterId, selStart, selEnd],
    );

    /**
     * R76: read the selection, painting each card as it lands.
     *
     * Three paths, in order: the local cache (no model call at all), the
     * streaming route (cards appear one by one), and — only when the stream
     * failed before producing anything — the unary route with model failover.
     * `opts.previous` asks for a different take on the same words.
     */
    const run = useCallback(
      async (opts) => {
        const options = opts || {};
        const token = runRef.current + 1;
        runRef.current = token;
        // R81: a new run (or a closed window) cancels the previous stream. The
        // host ties its model call to the HTTP connection, so this is what makes
        // 「关掉窗口」 actually stop the spend.
        if (abortRef.current) {
          try {
            abortRef.current.abort();
          } catch (err) {
            /* already gone */
          }
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = controller;
        const text = getText();
        const source = text.slice(selStart, selEnd);
        if (!source.trim()) {
          setError(NW.t('选中的文字已经不在这一章里了'));
          setItems(null);
          return;
        }
        const key = cacheKeyFor(source);
        const previous = String(options.previous || '');

        // Reopening the same window must not bill the model again.
        if (!options.force && !previous) {
          const hit = cacheGet(key);
          if (hit && Array.isArray(hit.items) && hit.items.length) {
            setItems(hit.items);
            setModel(String(hit.model || ''));
            setError('');
            setBusy(false);
            setFromCache(true);
            return;
          }
        }

        setFromCache(false);
        setBusy(true);
        setError('');
        setActiveId('');
        const nextVariant = previous ? variantRef.current + 1 : 1;
        variantRef.current = nextVariant;
        setVariant(nextVariant);

        // Host offsets are relative to the selection; shift them into chapter
        // coordinates exactly once, here.
        const shift = (item) =>
          Object.assign({}, item, {
            start: Number(item.start) >= 0 ? selStart + Number(item.start) : -1,
            end: Number(item.end) >= 0 ? selStart + Number(item.end) : -1,
            variant: nextVariant,
          });

        const before = text.slice(Math.max(0, selStart - 240), selStart);
        const after = text.slice(selEnd, selEnd + 240);
        const streamed = [];
        let result = null;
        try {
          if (typeof NW.ai.reviseSelectionStream === 'function') {
            try {
              result = await NW.ai.reviseSelectionStream(
                { text: source, before: before, after: after, previous: previous },
                {
                  signal: controller ? controller.signal : undefined,
                  onEvent: (event) => {
                    if (runRef.current !== token) return;
                    if (!event || event.type !== 'suggestion' || !event.item) return;
                    streamed.push(shift(event.item));
                    setItems(streamed.slice());
                  },
                },
              );
            } catch (streamError) {
              if (runRef.current !== token) return;
              // An explicit cancel is not a failure: don't paint an error card.
              if (streamError && streamError.code === 'aborted') return;
              if (streamed.length) {
                // Half a loaf is still bread: keep what already arrived.
                setError(NW.t('流式读到一半断了，下面是收到的部分'));
                result = { suggestions: [], model: '', partial: true };
              } else {
                result = null;
              }
            }
          }
          if (!result) {
            // The unary route is the one with model failover, so a dead default
            // model still ends with an answer instead of an error card.
            setItems(null);
            const fallback = await NW.ai.reviseSelectionSafe({
              text: source,
              before: before,
              after: after,
              previous: previous,
              onRetry: (candidate) => {
                if (runRef.current === token) setError(NW.t('换用 {0} 重试…', candidate.label));
              },
            });
            if (runRef.current !== token) return;
            const list = Array.isArray(fallback && fallback.suggestions) ? fallback.suggestions : [];
            result = { suggestions: list, model: String((fallback && fallback.model) || '') };
          }
          if (runRef.current !== token) return;
          const finalList = streamed.length
            ? streamed
            : (Array.isArray(result.suggestions) ? result.suggestions : []).map(shift);
          setItems(finalList);
          setModel(String(result.model || ''));
          // Only a first read is a cache candidate: 再改一版 is a different take.
          if (!previous && finalList.length) {
            cachePut(key, { items: finalList, model: String(result.model || ''), at: Date.now() });
          }
        } catch (err) {
          if (runRef.current !== token) return;
          if (err && err.code === 'aborted') return;
          setItems(null);
          setError(errText(err, '获取修改建议失败'));
        } finally {
          if (runRef.current === token) setBusy(false);
        }
      },
      [cacheKeyFor, getText, selStart, selEnd],
    );

    // Opening the window *is* the request: run immediately, and start clean on
    // a new range so yesterday's cards cannot sit under today's selection.
    React.useEffect(() => {
      runRef.current += 1;
      setItems(null);
      setError('');
      setActiveId('');
      setDecided({});
      setModel('');
      setApplied({});
      setFromCache(false);
      variantRef.current = 1;
      setVariant(1);
      madeRef.current = {};
      run({});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selStart, selEnd, chapterId]);

    // Esc closes the window — the same contract as every other transient surface
    // in the studio. R82: join the shared escape stack instead of a private
    // window listener, so one Esc closes only the topmost layer (a settings
    // dialog opened on top no longer gets closed together with this window).
    NW.useModalEscape(true, () => {
      if (typeof p.onClose === 'function') p.onClose();
    });

    // R77 (B3): 键盘走一遍 —— J/K 上下、A 接受、R 拒绝。输入框里打字时不抢键。
    // 这个 effect 放在 reveal / acceptItem 之后：deps 数组在渲染时求值，
    // 放在前面会撞上 const 的暂时性死区。

    const reveal = useCallback(
      (item) => {
        if (!item) return;
        setActiveId(item.id);
        const api = p.editorApi && p.editorApi.current;
        if (!api) return;
        // R76: after 替换 the original span no longer exists; point at the text
        // that replaced it instead of at whatever moved into those offsets.
        const appliedSpan = applied[item.id];
        const s = appliedSpan ? appliedSpan.start : Number(item.start);
        const e = appliedSpan ? appliedSpan.end : Number(item.end);
        if (s >= 0 && typeof api.setHighlights === 'function') {
          api.setHighlights([{ start: s, end: e, id: item.id, active: true }]);
        }
        if (s >= 0 && typeof api.centerRange === 'function') api.centerRange(s, e);
      },
      [applied, p.editorApi],
    );

    /**
     * R76: 替换到正文 — the one action that writes.
     *
     * 接受 still only records a decision. This is an explicit second click, and
     * it keeps enough state to put the original text back for as long as that
     * span still holds what we wrote.
     */
    const applyItem = useCallback(
      (item) => {
        const api = p.editorApi && p.editorApi.current;
        if (!api || !item) return;
        const revised = String(item.revised || '');
        if (!revised || typeof api.replaceRange !== 'function') return;
        const text = getText();
        let s = Number(item.start);
        let e = Number(item.end);
        const quote = String(item.quote || '');
        if (!(s >= 0 && e > s && text.slice(s, e) === quote)) {
          const at = quote ? text.indexOf(quote) : -1;
          if (at < 0) {
            if (typeof p.onToast === 'function') p.onToast(NW.t('原文已经改动，替换不了这一处'), 'warn');
            return;
          }
          s = at;
          e = at + quote.length;
        }
        api.replaceRange(s, e, revised);
        setApplied((prev) =>
          Object.assign({}, prev, { [item.id]: { start: s, end: s + revised.length, before: quote, after: revised } }),
        );
        if (typeof p.onToast === 'function') p.onToast(NW.t('已替换，可以撤销'), 'ok');
      },
      [getText, p.editorApi, p.onToast],
    );

    const undoApply = useCallback(
      (item) => {
        if (!item) return;
        const rec = applied[item.id];
        const api = p.editorApi && p.editorApi.current;
        if (!rec || !api || typeof api.replaceRange !== 'function') return;
        const text = getText();
        if (text.slice(rec.start, rec.end) !== rec.after) {
          // The writer edited on top of it: blindly restoring would eat their
          // work, so say so instead of guessing.
          if (typeof p.onToast === 'function') p.onToast(NW.t('正文已经改过，这一处撤销不了'), 'warn');
          return;
        }
        api.replaceRange(rec.start, rec.end, rec.before);
        setApplied((prev) => {
          const next = Object.assign({}, prev);
          delete next[item.id];
          return next;
        });
        if (typeof p.onToast === 'function') p.onToast(NW.t('已撤销替换'), 'ok');
      },
      [applied, getText, p.editorApi, p.onToast],
    );

    const copyItem = useCallback(
      (item) => {
        const value = String((item && item.revised) || '');
        if (!value) return;
        copyToClipboard(value).then((ok) => {
          if (typeof p.onToast === 'function') {
            p.onToast(ok ? NW.t('改后已经复制') : NW.t('复制失败，请手动选中'), ok ? 'ok' : 'warn');
          }
        });
      },
      [p.onToast],
    );

    // R76: 再改一版 — same words, the version just read as the thing to avoid.
    const regenerate = useCallback(
      (item) => {
        if (!item) return;
        run({ previous: String(item.revised || item.quote || ''), force: true });
      },
      [run],
    );

    const revealRow = useCallback(
      (row) => {
        const api = p.editorApi && p.editorApi.current;
        if (!api || !row) return;
        const span = locateRevision(row, getText());
        if (span.start < 0) return;
        if (typeof api.setHighlights === 'function') {
          api.setHighlights([{ start: span.start, end: span.end, id: row.id, active: true }]);
        }
        if (typeof api.centerRange === 'function') api.centerRange(span.start, span.end);
      },
      [getText, p.editorApi],
    );

    // Same decision flow as the dock's column; see Advice for the reasoning.
    const acceptItem = useCallback(
      async (item) => {
        if (!item || !chapterId || typeof p.onAccept !== 'function') return;
        setDecided((prev) => Object.assign({}, prev, { [item.id]: 'accepted' }));
        setSavingId(item.id);
        try {
          const row = await p.onAccept({
            quote: item.quote,
            revised: String(item.revised || ''),
            issue: item.issue,
            why: item.why,
            advice: item.advice,
            kind: item.kind,
            severity: item.severity,
            start: item.start,
            end: item.end,
            source: 'selection',
          });
          if (row && row.id) {
            madeRef.current = Object.assign({}, madeRef.current, { [item.id]: String(row.id) });
          }
        } catch (err) {
          setDecided((prev) => {
            const next = Object.assign({}, prev);
            delete next[item.id];
            return next;
          });
        } finally {
          setSavingId('');
        }
      },
      [chapterId, p.onAccept],
    );

    const rejectItem = useCallback((item) => {
      if (!item) return;
      setDecided((prev) => Object.assign({}, prev, { [item.id]: 'rejected' }));
    }, []);

    const undoItem = useCallback(
      async (item) => {
        if (!item) return;
        const was = decided[item.id];
        const rowId = madeRef.current[item.id];
        setDecided((prev) => {
          const next = Object.assign({}, prev);
          delete next[item.id];
          return next;
        });
        if (rowId) {
          const rest = Object.assign({}, madeRef.current);
          delete rest[item.id];
          madeRef.current = rest;
        }
        if (was === 'accepted' && rowId && typeof p.onRemoveAccepted === 'function') {
          try {
            await p.onRemoveAccepted({ id: rowId });
          } catch (err) {
            /* the store is the source of truth; a failed undo leaves the row */
          }
        }
      },
      [decided, p.onRemoveAccepted],
    );

    // R77 (B3): 键盘走一遍 —— J/K 上下、A 接受、R 拒绝。输入框里不抢键。
    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.defaultPrevented) return;
        const target = ev.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        // R82: same guard as the dock's handler (see above).
        if (target && (target.tagName === 'SELECT' || target.tagName === 'BUTTON')) return;
        if (target && typeof target.closest === 'function' && target.closest('.nw-modal-mask')) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return;
        const at = list.findIndex((row) => row.id === activeId);
        const pick = (index) => list[Math.max(0, Math.min(list.length - 1, index))];
        const key = String(ev.key || '');
        if (key === 'j' || key === 'J' || key === 'ArrowDown') {
          ev.preventDefault();
          reveal(pick(at < 0 ? 0 : at + 1));
          return;
        }
        if (key === 'k' || key === 'K' || key === 'ArrowUp') {
          ev.preventDefault();
          reveal(pick(at < 0 ? 0 : at - 1));
          return;
        }
        const current = at >= 0 ? list[at] : null;
        if (!current) return;
        if (key === 'a' || key === 'A') {
          ev.preventDefault();
          acceptItem(current);
          return;
        }
        if (key === 'r' || key === 'R') {
          ev.preventDefault();
          rejectItem(current);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [items, activeId, reveal, acceptItem, rejectItem]);

    const selectedText = String(selection.text || '').trim();
    const selectedCount = selEnd - selStart;

    const head = h(
      'div',
      { className: 'nw-selwin-head' },
      h('span', { className: 'nw-selwin-title' }, NW.t('修改建议')),
      h('span', { className: 'nw-selwin-count' }, NW.t('选中 {0} 字', selectedCount)),
      h('span', { style: { flex: '1 1 auto' } }),
      NW.ui.iconBtn(NW.icon('x', { size: 16 }), NW.t('关闭'), () => {
        const api = p.editorApi && p.editorApi.current;
        if (api && typeof api.setHighlights === 'function') api.setHighlights([]);
        if (typeof p.onClose === 'function') p.onClose();
      }),
    );

    const hasCards = Array.isArray(items) && items.length > 0;
    let body;
    if (busy && !hasCards) {
      body = h(
        'div',
        { className: 'nw-selwin-empty' },
        NW.ui.spinner(),
        h('span', null, NW.t('正在读选中的这段…')),
        h('span', { style: { fontSize: '12px', opacity: '.7' } }, NW.t('只改这一段，前后文只用来保证接得上。')),
      );
    } else if (error && !hasCards) {
      body = h(
        'div',
        { className: 'nw-selwin-empty' },
        h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, error),
        NW.ui.btn({ kind: 'primary', onClick: () => run({ force: true }), children: NW.t('重试') }),
      );
    } else if (!items) {
      body = h(
        'div',
        { className: 'nw-selwin-empty' },
        NW.icon('sparkle', { size: 24 }),
        NW.ui.btn({ kind: 'primary', onClick: () => run({ force: true }), children: NW.t('开始改写') }),
      );
    } else if (!hasCards && !busy) {
      body = h(
        'div',
        { className: 'nw-selwin-empty' },
        NW.icon('success', { size: 24 }),
        h('span', null, NW.t('这段放着就行，模型没找到值得改的地方。')),
        NW.ui.btn({ onClick: () => run({ force: true }), children: NW.t('再读一次') }),
      );
    } else {
      // R76: cards are painted as they stream in, so the body must keep showing
      // them while the request is still running — the spinner only owns the
      // empty case above.
      body = h(
        'div',
        { className: 'nw-selwin-body' },
        busy
          ? h(
              'div',
              { className: 'nw-selwin-progress' },
              NW.ui.spinner(),
              h('span', null, NW.t('还在读…后面可能还有')),
            )
          : null,
        error
          ? h(
              'div',
              { className: 'nw-selwin-progress', 'data-kind': 'warn' },
              h('span', null, error),
            )
          : null,
        items.map((item) =>
          h(AdviceCard, {
            key: item.id,
            item: item,
            state: decided[item.id] || 'pending',
            active: activeId === item.id,
            busy: savingId === item.id,
            applied: !!applied[item.id],
            variant: item.variant,
            onReveal: reveal,
            onAccept: acceptItem,
            onReject: rejectItem,
            onUndo: undoItem,
            onCopy: copyItem,
            onApply: applyItem,
            onUndoApply: undoApply,
            onRegenerate: regenerate,
          }),
        ),
      );
    }

    return h(
      'aside',
      { className: 'nw-selwin', 'aria-label': NW.t('选中文字的修改建议') },
      head,
      selectedText
        ? h('div', { className: 'nw-selwin-src' }, selectedText)
        : null,
      body,
      // The accepted list is the same component the dock uses, folded under the
      // new suggestions — "these are the ones I already said yes to". It shows
      // even while the new read is running, so the writer can look back at the
      // earlier decisions instead of waiting.
      h(
        'div',
        { className: 'nw-selwin-accepted' },
        h(AcceptedPanel, {
          rows: p.accepted,
          getText: getText,
          onReveal: revealRow,
          onRemove: p.onRemoveAccepted,
        }),
      ),
      h(
        'div',
        { className: 'nw-selwin-foot' },
        hasCards
          ? NW.ui.btn({
              onClick: () => run({ force: true }),
              disabled: busy,
              children: NW.t('重新读一次'),
            })
          : null,
        fromCache
          ? h('span', { className: 'nw-selwin-cached' }, NW.t('上次的结果 · 没有重新计费'))
          : null,
        h('span', { style: { flex: '1 1 auto' } }),
        model ? h('span', null, model) : null,
      ),
    );
  }

  NW.Advice = Advice;
  NW.AdviceCard = AdviceCard;
  NW.AcceptedPanel = AcceptedPanel;
  NW.SelectionAdvice = SelectionAdvice;
})();
