;(() => {
  'use strict';

  // =========================================================== 完稿版本 ======
  //
  // R175: 完稿版本 lives on the page, not in a manager dialog.
  //
  // The first attempt put two buttons in the status bar and opened a 1120px
  // modal that listed versions, previewed them and compared them. It worked,
  // but it read as a database tool: the writer had to leave the sentence to
  // "manage" something. This file is the second shape the writer chose:
  //
  //   · a narrow folio tab clipped to the top-right corner of the paper. It
  //     says 「稿 3」 all day; hovering it reveals 「完稿」, one click seals the
  //     live buffer. The count opens a drawer, not a modal.
  //   · the drawer is a paper-coloured slip that slides over the right margin.
  //     It lists this chapter's finals, lets one be pinned as 付印稿 (the version
  //     exports and submissions read), and opens an archived version in place.
  //   · reading an archived version covers the editor with a read-only sheet;
  //     the editor itself never unmounts, so closing the sheet restores the
  //     caret and the scroll position exactly.
  //   · selecting two versions opens the proofing desk: one scroll container,
  //     two aligned pages, margin notes for each run of changes. No twin
  //     scrollers to synchronise, no red/green blocks that turn prose into a
  //     CI diff.
  //
  // All state lives in the App shell (90-app.js). This file is deliberately
  // presentational: it owns no copy of the chapter, and every mutation goes back
  // through the shell so the editor, the status line and the export path keep
  // reading one truth.

  const { useState, useEffect, useMemo, useRef } = React;

  function numOf(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampNum(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function wordsOf(text) {
    const s = typeof text === 'string' ? text : '';
    try {
      if (NW.format && typeof NW.format.wordCount === 'function') {
        const n = NW.format.wordCount(s);
        if (Number.isFinite(n)) return n;
      }
    } catch (err) {
      /* fall through to the cheap estimate */
    }
    return s.replace(/\s+/g, '').length;
  }

  function wordsText(n) {
    const v = numOf(n, 0);
    return NW.fmtWords ? NW.fmtWords(v) : String(v);
  }

  function dateText(ts) {
    if (!ts) return '';
    try {
      return NW.fmtDate ? NW.fmtDate(ts) : new Date(ts).toLocaleString();
    } catch (err) {
      return '';
    }
  }

  // rows arrive newest first. The label is written at save time, so the only
  // fallback needed is for old rows created before labels existed.
  function labelOf(row, index, total) {
    const stored = row && row.label ? String(row.label) : '';
    if (stored) return stored;
    return '第' + Math.max(1, total - index) + '稿';
  }

  function seal(extraClass, title) {
    return NW.h(
      'span',
      {
        className: 'nw-folio-seal' + (extraClass ? ' ' + extraClass : ''),
        'aria-label': '付印稿',
      },
      '定',
    );
  }

  function icon(name, size) {
    return NW.icon ? NW.icon(name, { size: size || 14 }) : null;
  }

  // --------------------------------------------------------------- folio tab --
  //
  // The tab is a single control with two hit areas. The capture half is hidden
  // behind `max-width:0` until hover/focus, so at rest the paper corner only
  // says "稿 3" — a bookmark, not another toolbar. On a phone there is no hover,
  // so both halves stay open.
  NW.FolioTab = function FolioTab(props) {
    const p = props || {};
    const count = Math.max(0, numOf(p.count, 0));
    const finalLabel = p.finalLabel == null ? '' : String(p.finalLabel);
    return NW.h(
      'div',
      { className: 'nw-folio' + (p.finalId ? ' has-final' : '') },
      NW.h(
        'button',
        {
          type: 'button',
          className: 'nw-folio-capture',
          'aria-label': p.noChanges ? '完稿（没有改动）' : '完稿',
          disabled: !!p.busy || !!p.noChanges,
          onClick: p.onCapture,
        },
        icon('check', 13),
        NW.h('span', null, '完稿'),
      ),
      NW.h(
        'button',
        {
          type: 'button',
          className: 'nw-folio-open',
          title: p.finalId
            ? '当前付印稿' + (finalLabel ? '：' + finalLabel : '') + '；导出和投稿使用这一版'
            : '查看本章的完稿版本',
          'aria-label': p.finalId
            ? '查看完稿版本，共 ' + count + ' 稿，当前付印稿' + (finalLabel ? ' ' + finalLabel : '')
            : '查看完稿版本，共 ' + count + ' 稿',
          onClick: p.onOpen,
        },
        p.finalId
          ? NW.h(
              'span',
              { className: 'nw-folio-final' },
              seal('is-mini'),
              NW.h('span', { className: 'nw-folio-final-k' }, '付印稿'),
              finalLabel ? NW.h('strong', null, finalLabel) : null,
            )
          : NW.h(
              'span',
              { className: 'nw-folio-count' },
              NW.h('span', { className: 'nw-folio-k' }, '稿'),
              NW.h('strong', null, String(count)),
            ),
      ),
    );
  };

  // ------------------------------------------------------------ folio drawer --
  NW.FolioDrawer = function FolioDrawer(props) {
    const p = props || {};
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const finalId = p.finalId == null ? null : String(p.finalId);
    const [checked, setChecked] = useState([]);
    const [note, setNote] = useState('');
    const [saveAsFinal, setSaveAsFinal] = useState(!finalId);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const rowId = (row) => (row && row.id != null ? String(row.id) : '');

    useEffect(() => {
      setChecked((prev) =>
        prev.filter((id) => rows.some((row) => rowId(row) === String(id))).slice(0, 2),
      );
    }, [rows]);

    useEffect(() => {
      setSaveAsFinal(!finalId);
    }, [finalId]);

    useEffect(() => {
      setChecked([]);
      setNote('');
      setSaving(false);
    }, [p.chapterId]);

    if (!p.open) return null;

    const finalRow = rows.filter((row) => rowId(row) === finalId)[0] || null;
    const toggle = (id) => {
      const key = String(id);
      setChecked((prev) => {
        if (prev.indexOf(key) >= 0) return prev.filter((x) => x !== key);
        if (prev.length >= 2) return prev;
        return prev.concat(key);
      });
    };

    const capture = async () => {
      if (saving) return;
      setSaving(true);
      setSaveError('');
      try {
        await p.onCapture({ note: String(note || '').trim(), setFinal: !!saveAsFinal });
        setNote('');
      } catch (err) {
        setSaveError((err && err.message) || '保存失败，请再试一次');
      } finally {
        setSaving(false);
      }
    };

    const item = (row, index) => {
      const id = rowId(row);
      const isFinal = !!finalId && id === finalId;
      const isChecked = checked.indexOf(id) >= 0;
      const label = labelOf(row, index, rows.length);
      return NW.h(
        'article',
        { key: id || String(index), className: 'nw-folio-item' + (isFinal ? ' is-final' : '') + (isChecked ? ' is-checked' : '') },
        NW.h(
          'label',
          { className: 'nw-folio-check' },
          NW.h('input', {
            type: 'checkbox',
            checked: isChecked,
            onChange: () => toggle(id),
            'aria-label': '选择' + label,
          }),
        ),
        NW.h(
          'div',
          { className: 'nw-folio-item-body' },
          NW.h(
            'button',
            { type: 'button', className: 'nw-folio-item-main', onClick: () => p.onPreview(row) },
            NW.h(
              'span',
              { className: 'nw-folio-item-top' },
              NW.h('strong', null, label),
              isFinal ? seal('is-word') : null,
              index === 0 ? NW.h('span', { className: 'nw-folio-badge' }, '最新') : null,
            ),
            NW.h(
              'span',
              { className: 'nw-folio-meta' },
              dateText(row.createdAt) + (row.words != null ? ' · ' + wordsText(row.words) + ' 字' : ''),
            ),
            row.note
              ? NW.h('span', { className: 'nw-folio-note' }, String(row.note))
              : null,
          ),
          NW.h(
            'div',
            { className: 'nw-folio-acts' },
            isFinal
              ? NW.h('span', { className: 'nw-folio-current' }, '付印稿')
              : NW.h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-folio-act',
                    onClick: () => p.onSetFinal(row),
                  },
                  '定为付印',
                ),
            NW.h(
              'button',
              {
                type: 'button',
                className: 'nw-folio-act',
                onClick: () => p.onCompare([id, '__live__']),
              },
              '对比当前',
            ),
            NW.h(
              'button',
              {
                type: 'button',
                className: 'nw-folio-act',
                onClick: () => p.onRestore(row),
              },
              '恢复',
            ),
            NW.h(
              'button',
              {
                type: 'button',
                className: 'nw-folio-act is-danger',
                onClick: () => p.onDelete(row),
              },
              '删除',
            ),
          ),
        ),
      );
    };

    return [
      NW.h('button', {
        key: 'scrim',
        type: 'button',
        className: 'nw-folio-scrim',
        tabIndex: -1,
        'aria-label': '收起完稿面板',
        onClick: p.onClose,
      }),
      NW.h(
        'aside',
        {
          key: 'drawer',
          className: 'nw-folio-drawer',
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': '完稿版本',
        },
        NW.h(
          'header',
          { className: 'nw-folio-head' },
          NW.h(
            'div',
            { className: 'nw-folio-headtext' },
            NW.h('span', { className: 'nw-folio-kicker' }, '本章完稿'),
            NW.h('h3', null, p.chapterTitle || '当前章节'),
          ),
          NW.h(
            'button',
            { type: 'button', className: 'nw-folio-close', onClick: p.onClose, 'aria-label': '关闭' },
            icon('x', 16),
          ),
        ),
        NW.h(
          'div',
          { className: 'nw-folio-summary' },
          NW.h('span', null, rows.length ? '共 ' + rows.length + ' 稿' : '还没有完稿'),
          finalRow
            ? NW.h(
                'span',
                { className: 'nw-folio-finalnow' },
                seal('is-word'),
                '付印：' + labelOf(finalRow, rows.indexOf(finalRow), rows.length),
              )
            : NW.h('span', { className: 'nw-folio-muted' }, '尚未指定付印稿'),
        ),
        NW.h(
          'div',
          { className: 'nw-folio-savecard' },
          NW.h('label', { className: 'nw-folio-savelabel', htmlFor: 'nw-folio-note' }, '这一稿改了什么？'),
          NW.h('input', {
            id: 'nw-folio-note',
            className: 'nw-folio-noteinput',
            value: note,
            maxLength: 200,
            onChange: (e) => setNote(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                capture();
              }
            },
          }),
          NW.h(
            'div',
            { className: 'nw-folio-saverow' },
            NW.h(
              'label',
              { className: 'nw-folio-asfinal' },
              NW.h('input', {
                type: 'checkbox',
                checked: saveAsFinal,
                onChange: (e) => setSaveAsFinal(e.target.checked),
              }),
              NW.h('span', null, '同时设为付印稿'),
            ),
            NW.h(
              'button',
              {
                type: 'button',
                className: 'nw-folio-primary',
                disabled: saving || !!p.busy,
                onClick: capture,
              },
              saving ? '保存中…' : '完稿',
            ),
          ),
          saveError ? NW.h('p', { className: 'nw-folio-saveerror', role: 'alert' }, saveError) : null,
        ),
        NW.h(
          'div',
          { className: 'nw-folio-list', role: 'list' },
          rows.length
            ? rows.map(item)
            : NW.h(
                'div',
                { className: 'nw-folio-empty' },
                NW.h('p', null, '还没有完稿版本。'),
              ),
        ),
        NW.h(
          'footer',
          { className: 'nw-folio-foot' },
          NW.h(
            'span',
            { className: 'nw-folio-footnote' },
            checked.length === 2 ? '已选两稿' : '勾选两稿，并排校样',
          ),
          NW.h(
            'button',
            {
              type: 'button',
              className: 'nw-folio-primary',
              disabled: checked.length !== 2,
              onClick: () => p.onCompare(checked.slice()),
            },
            '并排校样',
          ),
        ),
      ),
    ];
  };

  // ----------------------------------------------------------- folio preview --
  //
  // An archived version is read *in place*. The editor stays mounted underneath
  // this sheet, so 「回到正文」 returns to the exact sentence and scroll offset
  // the writer left — no chapter reload, no caret at the top.
  NW.FolioPreview = function FolioPreview(props) {
    const p = props || {};
    const row = p.row || null;

    useEffect(() => {
      if (!row) return undefined;
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          p.onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [row, p.onClose]);

    if (!row) return null;

    const settings = p.settings || {};
    const size = clampNum(numOf(settings.fontSize, 20), 11, 42);
    const line = clampNum(numOf(settings.lineHeight, 2), 1.1, 3.4);
    const width = clampNum(numOf(settings.pageWidth, 760), 360, 1400);
    const isFinal = p.finalId != null && String(p.finalId) === String(row.id);
    const label = row.label || '完稿';

    return NW.h(
      'section',
      { className: 'nw-folio-read', role: 'dialog', 'aria-modal': 'true', 'aria-label': '完稿预览' },
      NW.h(
        'header',
        { className: 'nw-folio-readbar' },
        NW.h(
          'button',
          { type: 'button', className: 'nw-folio-back', onClick: p.onClose, autoFocus: true },
          icon('chevleft', 14),
          NW.h('span', null, '回到正文'),
        ),
        NW.h(
          'div',
          { className: 'nw-folio-readmeta' },
          NW.h('strong', null, '正在看 ' + label),
          NW.h('span', null, dateText(row.createdAt) + ' · ' + wordsText(row.words) + ' 字'),
          isFinal ? seal('is-word') : null,
        ),
        NW.h(
          'div',
          { className: 'nw-folio-readacts' },
          isFinal
            ? NW.h('span', { className: 'nw-folio-current' }, '付印稿')
            : NW.h(
                'button',
                { type: 'button', className: 'nw-folio-act', onClick: () => p.onSetFinal(row) },
                '定为付印稿',
              ),
          NW.h(
            'button',
            { type: 'button', className: 'nw-folio-act', onClick: () => p.onCompare([row.id, '__live__']) },
            '对比当前',
          ),
          NW.h(
            'button',
            { type: 'button', className: 'nw-folio-act', onClick: () => p.onRestore(row) },
            '恢复此稿',
          ),
        ),
      ),
      NW.h(
        'div',
        { className: 'nw-folio-readscroll' },
        NW.h(
          'article',
          { className: 'nw-folio-readpaper', style: { maxWidth: width + 'px' } },
          NW.h('h2', { className: 'nw-folio-readtitle' }, p.chapterTitle || ''),
          NW.h(
            'div',
            {
              className: 'nw-folio-readtext',
              style: {
                fontSize: size + 'px',
                lineHeight: String(line),
                fontFamily: settings.fontFamily ? String(settings.fontFamily) : undefined,
              },
            },
            String(row.content || ''),
          ),
        ),
      ),
    );
  };

  // ------------------------------------------------------------ proof desk ---
  //
  // One scroll container owns both pages. That is the whole sync-scroll design:
  // each row is a grid with the left page and the right page in the same box, so
  // line N of the left manuscript and line N of the right one share a baseline
  // by construction. There are no two scrollers to chase, no `scrollTop` echo,
  // and no drift after images or long paragraphs reflow.
  NW.ProofDesk = function ProofDesk(props) {
    const p = props || {};
    const versions = Array.isArray(p.versions) ? p.versions : [];
    const [leftId, setLeftId] = useState(p.pair ? p.pair.left : '__live__');
    const [rightId, setRightId] = useState(p.pair ? p.pair.right : '__live__');
    const [left, setLeft] = useState(null);
    const [right, setRight] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const scrollRef = useRef(null);

    useEffect(() => {
      if (!p.pair) return;
      setLeftId(p.pair.left);
      setRightId(p.pair.right);
    }, [p.pair && p.pair.left, p.pair && p.pair.right]);

    useEffect(() => {
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          p.onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        window.removeEventListener('keydown', onKey);
        document.body.style.overflow = prev;
      };
    }, [p.onClose]);

    const metaFor = (id) => versions.filter((row) => row && String(row.id) === String(id))[0] || null;

    useEffect(() => {
      let alive = true;
      setLoading(true);
      setError('');
      const load = async (id) => {
        if (String(id) === '__live__') {
          const text = String(p.liveText || '');
          return { id: '__live__', label: '当前正文', content: text, words: wordsOf(text), live: true };
        }
        const meta = metaFor(id);
        if (!meta) throw new Error('这一版已经不存在');
        const full = await NW.db.getVersion(id);
        if (!full) throw new Error('这一版已经不存在');
        return Object.assign({}, meta, full, { label: meta.label || full.label || '完稿' });
      };
      Promise.all([load(leftId), load(rightId)])
        .then((pair) => {
          if (!alive) return;
          setLeft(pair[0]);
          setRight(pair[1]);
        })
        .catch((err) => {
          if (alive) setError(err && err.message ? err.message : '读取完稿失败');
        })
        .then(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }, [leftId, rightId, p.liveText, versions]);

    const stats = useMemo(() => {
      if (!left || !right || !NW.format || typeof NW.format.diffAligned !== 'function') {
        return { rows: [], stats: { added: 0, removed: 0, changed: 0 } };
      }
      try {
        return NW.format.diffAligned(String(left.content || ''), String(right.content || ''));
      } catch (err) {
        return { rows: [], stats: { added: 0, removed: 0, changed: 0 } };
      }
    }, [left, right]);

    const notes = useMemo(() => {
      const rows = stats.rows || [];
      const out = [];
      let block = null;
      rows.forEach((row, index) => {
        if (!row || row.type === 'same') {
          block = null;
          return;
        }
        if (!block) {
          block = { start: index, end: index, text: '', add: 0, del: 0, changed: 0 };
          out.push(block);
        }
        block.end = index;
        if (row.type === 'changed') {
          block.changed += 1;
          block.add += row.right ? String(row.right.text || '').length : 0;
          block.del += row.left ? String(row.left.text || '').length : 0;
        } else if (row.type === 'right') {
          block.add += row.right ? String(row.right.text || '').length : 0;
        } else if (row.type === 'left') {
          block.del += row.left ? String(row.left.text || '').length : 0;
        }
        if (!block.text) {
          const sample = (row.right && row.right.text) || (row.left && row.left.text) || '';
          block.text = String(sample).trim().slice(0, 36) || '空行';
        }
      });
      return out;
    }, [stats]);

    const options = useMemo(() => {
      const list = versions
        .slice()
        .reverse()
        .map((row, index, all) => ({
          id: String(row.id),
          label: labelOf(row, all.length - 1 - index, all.length),
          words: row.words,
          createdAt: row.createdAt,
        }));
      list.push({ id: '__live__', label: '当前正文', words: wordsOf(p.liveText), createdAt: 0 });
      return list;
    }, [versions, p.liveText]);

    const labelOfId = (id) => {
      const found = options.filter((opt) => opt.id === String(id))[0];
      if (found) return found.label;
      const loaded = (left && String(left.id) === String(id) && left) || (right && String(right.id) === String(id) && right);
      return (loaded && loaded.label) || '版本';
    };

    const setSide = (side, id) => {
      if (side === 'left') {
        if (String(id) === String(rightId)) return;
        setLeftId(id);
      } else {
        if (String(id) === String(leftId)) return;
        setRightId(id);
      }
    };

    const swap = () => {
      const a = leftId;
      setLeftId(rightId);
      setRightId(a);
    };

    const jump = (index) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const target = scroller.querySelector('[data-row="' + String(index) + '"]');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };

    const restore = (row) => {
      if (!row || row.live) return;
      p.onRestore(row);
    };

    const pageHead = (side, row) => {
      const id = side === 'left' ? leftId : rightId;
      const isLive = String(id) === '__live__';
      const isFinal = !isLive && p.finalId != null && String(p.finalId) === String(id);
      if (!row && !isLive) {
        return NW.h(
          'div',
          { className: 'nw-proof-pagehead' },
          NW.h(
            'div',
            { className: 'nw-proof-pageheadtext' },
            NW.h('strong', null, labelOfId(id)),
            NW.h('span', null, '载入中…'),
          ),
        );
      }
      return NW.h(
        'div',
        { className: 'nw-proof-pagehead' },
        NW.h(
          'div',
          { className: 'nw-proof-pageheadtext' },
          NW.h('strong', null, labelOfId(id)),
          NW.h(
            'span',
            null,
            isLive
              ? wordsText(wordsOf(p.liveText)) + ' 字'
              : dateText(row && row.createdAt) + ' · ' + wordsText(row && row.words) + ' 字',
          ),
        ),
        NW.h(
          'div',
          { className: 'nw-proof-pageacts' },
          isLive
            ? NW.h('span', { className: 'nw-proof-livebadge' }, '当前草稿')
            : isFinal
              ? seal('is-word')
              : NW.h(
                  'button',
                  { type: 'button', className: 'nw-proof-smallbtn', onClick: () => p.onSetFinal(row) },
                  '定为付印',
                ),
          isLive
            ? null
            : NW.h(
                'button',
                { type: 'button', className: 'nw-proof-smallbtn', onClick: () => restore(row) },
                '恢复此稿',
              ),
        ),
      );
    };

    const renderSegs = (side) => {
      if (!side) return null;
      if (Array.isArray(side.segs) && side.segs.length) {
        return side.segs.map((seg, index) =>
          seg.t === 'mark'
            ? NW.h('mark', { key: index, className: 'nw-proof-mark' }, String(seg.text || ''))
            : NW.h('span', { key: index }, String(seg.text || '')),
        );
      }
      return String(side.text || '');
    };

    const page = (side) =>
      NW.h(
        'div',
        { className: 'nw-proof-page' + (side ? '' : ' is-empty') },
        NW.h('span', { className: 'nw-proof-no' }, side ? String(side.no) : ''),
        NW.h('span', { className: 'nw-proof-line' }, side ? renderSegs(side) : ''),
      );

    const rowEl = (row, index) =>
      NW.h(
        'div',
        { key: index, className: 'nw-proof-row is-' + row.type, 'data-row': index },
        page(row.left),
        page(row.right),
      );

    return NW.h(
      'section',
      { className: 'nw-proof', role: 'dialog', 'aria-modal': 'true', 'aria-label': '并排校样' },
      NW.h(
        'header',
        { className: 'nw-proof-head' },
        NW.h(
          'button',
          { type: 'button', className: 'nw-proof-back', onClick: p.onClose },
          icon('chevleft', 14),
          NW.h('span', null, '回到写作'),
        ),
        NW.h(
          'div',
          { className: 'nw-proof-title' },
          NW.h('span', null, '并排校样'),
          NW.h('strong', null, p.chapterTitle || '当前章节'),
        ),
        NW.h(
          'div',
          { className: 'nw-proof-selects' },
          NW.h(
            'select',
            {
              className: 'nw-proof-select',
              value: leftId,
              'aria-label': '左页版本',
              onChange: (e) => setSide('left', e.target.value),
            },
            options.map((opt) =>
              NW.h('option', { key: opt.id, value: opt.id, disabled: opt.id === rightId }, opt.label),
            ),
          ),
          NW.h(
            'button',
            { type: 'button', className: 'nw-proof-swap', onClick: swap, title: '交换左右', 'aria-label': '交换左右' },
            '⇄',
          ),
          NW.h(
            'select',
            {
              className: 'nw-proof-select',
              value: rightId,
              'aria-label': '右页版本',
              onChange: (e) => setSide('right', e.target.value),
            },
            options.map((opt) =>
              NW.h('option', { key: opt.id, value: opt.id, disabled: opt.id === leftId }, opt.label),
            ),
          ),
        ),
        NW.h(
          'div',
          { className: 'nw-proof-stats' },
          NW.h('span', { className: 'nw-proof-add' }, '+' + wordsText(stats.stats.added)),
          NW.h('span', { className: 'nw-proof-del' }, '−' + wordsText(stats.stats.removed)),
          NW.h('span', { className: 'nw-proof-chg' }, '改 ' + wordsText(stats.stats.changed)),
          NW.h('em', null, String(stats.rows.length) + ' 行'),
        ),
        NW.h(
          'button',
          { type: 'button', className: 'nw-proof-close', onClick: p.onClose, 'aria-label': '退出校样' },
          icon('x', 16),
        ),
      ),
      NW.h(
        'div',
        { className: 'nw-proof-body' },
        NW.h(
          'aside',
          { className: 'nw-proof-rail', 'aria-label': '本章版本' },
          NW.h('div', { className: 'nw-proof-railhead' }, '本章 · ' + versions.length + ' 稿'),
          NW.h(
            'div',
            { className: 'nw-proof-folios' },
            versions.map((row, index) =>
              NW.h(
                'button',
                {
                  key: String(row.id),
                  type: 'button',
                  className:
                    'nw-proof-folio'
                    + (String(leftId) === String(row.id) ? ' is-left' : '')
                    + (String(rightId) === String(row.id) ? ' is-right' : ''),
                  onClick: (e) => setSide(e.shiftKey ? 'right' : 'left', String(row.id)),
                },
                NW.h('span', { className: 'nw-proof-folio-no' }, labelOf(row, index, versions.length)),
                NW.h(
                  'span',
                  { className: 'nw-proof-folio-meta' },
                  dateText(row.createdAt) + ' · ' + wordsText(row.words) + ' 字',
                ),
                p.finalId != null && String(p.finalId) === String(row.id) ? seal('is-mini') : null,
              ),
            ),
            NW.h(
              'button',
              {
                type: 'button',
                className: 'nw-proof-folio nw-proof-foliolive' + (String(leftId) === '__live__' || String(rightId) === '__live__' ? ' is-left' : ''),
                onClick: (e) => setSide(e.shiftKey ? 'right' : 'left', '__live__'),
              },
              NW.h('span', { className: 'nw-proof-folio-no' }, '当前正文'),
              NW.h('span', { className: 'nw-proof-folio-meta' }, '编辑器里的这一稿'),
            ),
          ),
        ),
        NW.h(
          'main',
          { className: 'nw-proof-stage' },
          NW.h(
            'div',
            { className: 'nw-proof-pageheads' },
            pageHead('left', left),
            pageHead('right', right),
          ),
          NW.h(
            'div',
            { className: 'nw-proof-scroll', ref: scrollRef },
            loading
              ? NW.h('div', { className: 'nw-proof-state' }, NW.ui.spinner('正在铺开校样…'))
              : error
                ? NW.h('div', { className: 'nw-proof-state is-error' }, error)
                : !left || !right
                  ? null
                  : NW.h(
                      'div',
                      { className: 'nw-proof-grid' },
                      stats.rows.slice(0, 4000).map(rowEl),
                    ),
            !loading && !error && stats.rows.length > 4000
              ? NW.h('div', { className: 'nw-proof-truncated' }, '内容较长，只显示前 4000 行差异。')
              : null,
          ),
        ),
        NW.h(
          'aside',
          { className: 'nw-proof-notes', 'aria-label': '校样批注' },
          NW.h('div', { className: 'nw-proof-noteshead' }, '校样批注'),
          notes.length
            ? NW.h(
                'div',
                { className: 'nw-proof-notelist' },
                notes.map((note) =>
                  NW.h(
                    'button',
                    {
                      key: note.start,
                      type: 'button',
                      className: 'nw-proof-note',
                      onClick: () => jump(note.start),
                      title: note.text,
                    },
                    NW.h('span', { className: 'nw-proof-noteno' }, '第 ' + (note.start + 1) + ' 行'),
                    NW.h('span', { className: 'nw-proof-notetext' }, note.text),
                    NW.h(
                      'span',
                      { className: 'nw-proof-notecount' },
                      (note.add ? '+' + wordsText(note.add) + ' ' : '') + (note.del ? '−' + wordsText(note.del) : ''),
                    ),
                  ),
                ),
              )
            : NW.h('p', { className: 'nw-proof-notesempty' }, '两页一致，没有要圈出的改动。'),
          NW.h(
            'div',
            { className: 'nw-proof-notesfoot' },
            notes.length ? notes.length + ' 处改动' : '对照阅读',
          ),
        ),
      ),
    );
  };

  NW.CSS_PARTS.push(`
/* ======================================================== 完稿版本 ======== */
/* The folio tab is clipped to the top-right corner of the paper. At rest it is
   just a bookmark («稿 3»); hover/focus unfolds the one-click capture half. */
.nw-folio{
  position:absolute;top:14px;
  /* R177: keep the bookmark anchored to the paper's top-right corner. The old
     formula jumped between "outside the measure" and 12px as the pane resized,
     which made it look like it was drifting; one stable offset reads as a
     bookmark instead of a floating tool. */
  right:12px;
  z-index:var(--nw-z-float,10);
  display:flex;align-items:center;gap:2px;
  font-family:var(--nw-ui-font,inherit);font-size:11px;
  user-select:none;
  transition:opacity .12s ease,transform .12s ease,visibility .12s;
}
/* 查找替换的浮条占着同一角。它一出现，稿签就让位——findbar 是临时的
   操作面板，不该同时和一枚常驻按钮抢注意力。 */
.nw-bench:has(.nw-findbar) .nw-folio{
  opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-3px);
}
.nw-folio-capture{
  display:inline-flex;align-items:center;gap:4px;height:27px;
  max-width:84px;opacity:1;overflow:hidden;padding:0 9px;
  border:1px solid color-mix(in srgb,var(--nw-brand) 18%,transparent);
  border-radius:13px;background:color-mix(in srgb,var(--nw-brand) 4%,transparent);color:var(--nw-brand);
  font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;
  transition:max-width .18s var(--nw-ease,ease),opacity .16s ease,padding .18s ease,
    background .16s ease,border-color .16s ease;
}
.nw-folio:hover .nw-folio-capture,.nw-folio:focus-within .nw-folio-capture{
  border-color:color-mix(in srgb,var(--nw-brand) 28%,transparent);
  background:color-mix(in srgb,var(--nw-brand) 7%,transparent);
}
.nw-folio-capture:hover{background:color-mix(in srgb,var(--nw-brand) 13%,transparent);}
.nw-folio-capture:disabled{opacity:.45;cursor:default;}
.nw-folio-open{
  display:inline-flex;align-items:center;gap:4px;height:27px;padding:0 9px;
  font-size:11.5px;
  border:1px solid var(--nw-line-soft);border-radius:13.5px;
  background:color-mix(in srgb,var(--nw-panel) 82%,transparent);
  color:var(--nw-fg-soft);font:inherit;cursor:pointer;
  box-shadow:var(--nw-shadow-1);
  transition:border-color .16s ease,color .16s ease,background .16s ease;
}
.nw-folio-open:hover,.nw-folio-open:focus-visible{
  border-color:color-mix(in srgb,var(--nw-brand) 30%,var(--nw-line-soft));
  color:var(--nw-fg);
}
.nw-folio-k{letter-spacing:.08em;opacity:.75;}
.nw-folio-open strong{font-weight:600;font-variant-numeric:tabular-nums;color:var(--nw-fg);}
.nw-folio.has-final .nw-folio-open{
  border-color:color-mix(in srgb,var(--nw-brand) 34%,var(--nw-line-soft));
  background:color-mix(in srgb,var(--nw-brand) 8%,var(--nw-panel));
  color:var(--nw-brand);
}
.nw-folio.has-final .nw-folio-open:hover,.nw-folio.has-final .nw-folio-open:focus-visible{
  border-color:color-mix(in srgb,var(--nw-brand) 52%,var(--nw-line-soft));
  background:color-mix(in srgb,var(--nw-brand) 12%,var(--nw-panel));
  color:var(--nw-brand);
}
.nw-folio-final{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}
.nw-folio-final-k{letter-spacing:.03em;font-weight:600;}
.nw-folio-final strong{color:color-mix(in srgb,var(--nw-brand) 82%,var(--nw-fg));}
.nw-folio-seal{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border:1.4px solid color-mix(in srgb,var(--nw-brand) 72%,#8f2f23);
  border-radius:3px;color:color-mix(in srgb,var(--nw-brand) 72%,#8f2f23);
  font-family:Georgia,"Songti SC",serif;font-size:10px;line-height:1;
  transform:rotate(-5deg);flex:0 0 auto;
}
.nw-folio-seal.is-mini{width:15px;height:15px;font-size:8px;border-width:1.1px;}
.nw-folio-seal.is-word{width:20px;height:20px;font-size:11px;margin:0 2px;}

.nw-main.has-folio .nw-bench{
  /* The drawer is a slip of paper laid beside the manuscript, not a pane of
     glass on top of it. Reserve its width so no line of prose ends up under
     the drawer; the page re-centres in the narrower column while it is open. */
  padding-right:376px;
  transition:padding-right .24s var(--nw-ease,ease);
}
@container nw (max-width:980px){
  /* Too narrow to give the drawer its own lane: let it cover the paper instead
     of squeezing the measure below a readable width. */
  .nw-main.has-folio .nw-bench{padding-right:0;transition:none;}
}
.nw-folio-scrim{
  position:absolute;inset:0;z-index:var(--nw-z-panel,20);
  display:block;margin:0;padding:0;border:0;
  background:color-mix(in srgb,var(--nw-fg) 8%,transparent);
  cursor:default;
  animation:nw-folio-fade .2s ease;
}
.nw-folio-drawer{
  position:absolute;top:0;right:0;bottom:0;z-index:calc(var(--nw-z-panel,20) + 1);
  display:flex;flex-direction:column;width:376px;max-width:94%;min-height:0;
  background:
    linear-gradient(180deg,color-mix(in srgb,var(--nw-brand) 4%,transparent),transparent 200px),
    color-mix(in srgb,var(--nw-panel) 94%,var(--nw-brand));
  border-left:1px solid color-mix(in srgb,var(--nw-fg) 12%,var(--nw-line-soft));
  box-shadow:-30px 0 70px color-mix(in srgb,var(--nw-fg) 17%,transparent),
             -1px 0 0 color-mix(in srgb,var(--nw-fg) 6%,transparent);
  animation:nw-folio-in .24s var(--nw-ease,ease);
}
.nw-folio-head{
  display:flex;align-items:flex-start;gap:10px;
  padding:18px 16px 10px;
}
.nw-folio-headtext{min-width:0;flex:1 1 auto;}
.nw-folio-kicker{
  display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--nw-fg-soft);margin-bottom:3px;
}
.nw-folio-head h3{
  margin:0;font-size:17px;font-weight:500;line-height:1.35;color:var(--nw-fg);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-folio-close{
  display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
  flex:0 0 auto;border:1px solid transparent;border-radius:8px;
  background:transparent;color:var(--nw-fg-soft);cursor:pointer;
}
.nw-folio-close:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-folio-summary{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:0 16px 12px;font-size:11px;color:var(--nw-fg-soft);
}
.nw-folio-finalnow{display:inline-flex;align-items:center;gap:4px;color:var(--nw-fg);}
.nw-folio-muted{opacity:.72;}

.nw-folio-savecard{
  margin:0 14px 10px;padding:11px 12px 10px;
  border:1px dashed color-mix(in srgb,var(--nw-brand) 28%,var(--nw-line-soft));
  border-radius:11px;
  background:color-mix(in srgb,var(--nw-brand) 3.5%,var(--nw-bg));
}
.nw-folio-savelabel{display:block;font-size:11px;color:var(--nw-fg-soft);margin-bottom:6px;}
.nw-folio-noteinput{
  width:100%;box-sizing:border-box;height:29px;padding:0 9px;
  border:1px solid var(--nw-line-soft);border-radius:7px;
  background:var(--nw-bg);color:var(--nw-fg);font:inherit;font-size:12px;outline:none;
}
.nw-folio-noteinput::placeholder{color:var(--nw-fg-soft);opacity:.6;}
.nw-folio-noteinput:focus{border-color:color-mix(in srgb,var(--nw-brand) 45%,var(--nw-line-soft));box-shadow:var(--nw-ring-soft);}
.nw-folio-saverow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;}
.nw-folio-asfinal{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--nw-fg-soft);cursor:pointer;}
.nw-folio-asfinal input{accent-color:var(--nw-brand);margin:0;}
.nw-folio-primary{
  display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 13px;
  border:1px solid color-mix(in srgb,var(--nw-brand) 55%,transparent);border-radius:14px;
  background:var(--nw-brand);color:var(--nw-on-brand);
  font:inherit;font-size:11.5px;font-weight:500;cursor:pointer;
  transition:filter .16s ease,opacity .16s ease;
}
.nw-folio-primary:hover{filter:brightness(1.05);}
.nw-folio-primary:disabled{opacity:.42;cursor:default;filter:none;}
.nw-folio-saveerror{margin:7px 0 0;font-size:10.5px;line-height:1.5;color:var(--nw-danger,#b4483f);}
.nw-folio-hint{margin:7px 0 0;font-size:10px;line-height:1.5;color:var(--nw-fg-soft);opacity:.75;}

.nw-folio-list{flex:1 1 auto;min-height:0;overflow:auto;padding:2px 10px 12px;}
.nw-folio-item{
  display:grid;grid-template-columns:17px minmax(0,1fr);gap:7px;
  padding:10px 6px;border-bottom:1px solid var(--nw-line-soft);
  border-radius:7px;
}
.nw-folio-item.is-final{background:color-mix(in srgb,var(--nw-brand) 4%,transparent);}
.nw-folio-item.is-checked{background:color-mix(in srgb,var(--nw-brand) 8%,transparent);}
.nw-folio-check{display:flex;align-items:flex-start;justify-content:center;padding-top:3px;}
.nw-folio-check input{accent-color:var(--nw-brand);margin:0;cursor:pointer;}
.nw-folio-item-body{display:flex;flex-direction:column;gap:5px;min-width:0;}
.nw-folio-item-main{
  display:flex;flex-direction:column;gap:3px;min-width:0;
  padding:0;border:0;background:transparent;color:inherit;
  font:inherit;text-align:left;cursor:pointer;
}
.nw-folio-item-top{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.nw-folio-item-top strong{font-size:13px;font-weight:600;color:var(--nw-fg);}
.nw-folio-badge{
  font-size:8.5px;letter-spacing:.06em;padding:1px 5px;border-radius:7px;
  color:var(--nw-fg-soft);background:var(--nw-sunken);
}
.nw-folio-meta{font-size:11px;color:var(--nw-fg-soft);font-variant-numeric:tabular-nums;}
.nw-folio-note{
  font-size:12px;line-height:1.45;color:var(--nw-fg);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-folio-acts{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding-left:1px;}
.nw-folio-act{
  padding:0;border:0;background:transparent;
  color:color-mix(in srgb,var(--nw-fg) 68%,var(--nw-fg-soft));
  font:inherit;font-size:11px;cursor:pointer;
}
.nw-folio-act:hover{color:var(--nw-brand);}
.nw-folio-act.is-danger:hover{color:var(--nw-danger);}
.nw-folio-current{font-size:10.5px;color:var(--nw-brand);}
.nw-folio-empty{padding:28px 14px;text-align:center;color:var(--nw-fg-soft);}
.nw-folio-empty p{margin:0 0 7px;font-size:12px;line-height:1.6;}
.nw-folio-empty p:last-child{font-size:11px;opacity:.7;}
.nw-folio-foot{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));
  border-top:1px solid var(--nw-line-soft);background:var(--nw-panel);
}
.nw-folio-footnote{font-size:10.5px;color:var(--nw-fg-soft);}

/* Read-only archive sheet: covers the paper, not the shell. The editor stays
   mounted underneath so closing it restores caret + scroll without a reload. */
.nw-folio-read{
  position:absolute;inset:0;z-index:calc(var(--nw-z-panel,20) + 4);
  display:flex;flex-direction:column;min-height:0;
  background:var(--nw-bg);
  animation:nw-folio-fade .18s ease;
}
.nw-folio-readbar{
  display:flex;align-items:center;gap:12px;min-height:44px;padding:0 16px;
  border-bottom:1px solid var(--nw-line-soft);
  background:color-mix(in srgb,var(--nw-panel) 88%,var(--nw-bg));
  flex-wrap:wrap;
}
.nw-folio-back{
  display:inline-flex;align-items:center;gap:3px;height:28px;padding:0 7px;
  border:1px solid transparent;border-radius:7px;
  background:transparent;color:var(--nw-fg-soft);font:inherit;font-size:11.5px;cursor:pointer;
}
.nw-folio-back:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-folio-readmeta{display:flex;align-items:center;gap:7px;min-width:0;font-size:11px;color:var(--nw-fg-soft);}
.nw-folio-readmeta strong{font-size:12px;font-weight:600;color:var(--nw-fg);white-space:nowrap;}
.nw-folio-readmeta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nw-folio-readacts{display:flex;align-items:center;gap:11px;margin-left:auto;flex-wrap:wrap;}
.nw-folio-readscroll{flex:1 1 auto;min-height:0;overflow:auto;}
.nw-folio-readpaper{margin:0 auto;padding:42px 30px 90px;box-sizing:border-box;}
.nw-folio-readtitle{
  margin:0 0 24px;font-size:1.25em;font-weight:600;line-height:1.5;color:var(--nw-fg);
}
.nw-folio-readtext{
  white-space:pre-wrap;overflow-wrap:anywhere;
  color:var(--nw-fg);text-align:justify;text-align-last:left;
}

/* ========================================================== 校样台 ======= */
.nw-proof{
  position:fixed;inset:0;z-index:calc(var(--nw-z-modal,40) + 4);
  display:flex;flex-direction:column;min-height:0;overflow:hidden;
  color:#ece3d5;
  background-color:#221c16;
  background-image:
    radial-gradient(120% 80% at 15% 0%,rgba(210,168,112,.10),transparent 55%),
    radial-gradient(120% 90% at 88% 100%,rgba(126,84,58,.10),transparent 60%),
    linear-gradient(180deg,#241d16,#1c1711);
  animation:nw-folio-fade .18s ease;
}
.nw-proof-head{
  display:flex;align-items:center;gap:14px;min-height:52px;padding:8px 16px;
  border-bottom:1px solid rgba(236,227,213,.13);
  background:rgba(0,0,0,.12);
  flex:0 0 auto;
}
.nw-proof-back{
  display:inline-flex;align-items:center;gap:3px;height:29px;padding:0 8px;
  border:1px solid transparent;border-radius:7px;
  background:transparent;color:#d9cdbb;font:inherit;font-size:12px;cursor:pointer;
}
.nw-proof-back:hover{background:rgba(255,255,255,.07);color:#fff8ec;}
.nw-proof-title{display:flex;flex-direction:column;min-width:0;line-height:1.25;}
.nw-proof-title span{font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:rgba(236,227,213,.55);}
.nw-proof-title strong{font-size:14.5px;font-weight:500;color:#f4eadb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;}
.nw-proof-selects{display:flex;align-items:center;gap:6px;margin-left:auto;}
.nw-proof-select{
  height:28px;max-width:150px;padding:0 7px;
  border:1px solid rgba(236,227,213,.2);border-radius:7px;
  background:rgba(255,255,255,.055);color:#efe5d5;font:inherit;font-size:11px;outline:none;
}
.nw-proof-select:focus{border-color:rgba(230,190,125,.65);}
.nw-proof-select option{background:#2a2119;color:#f0e5d4;}
.nw-proof-swap{
  width:26px;height:26px;border:1px solid rgba(236,227,213,.18);border-radius:50%;
  background:transparent;color:#d9cdbb;font:inherit;font-size:14px;line-height:1;cursor:pointer;
}
.nw-proof-swap:hover{background:rgba(255,255,255,.07);color:#fff8ec;}
.nw-proof-stats{display:flex;align-items:center;gap:8px;font-size:11px;font-variant-numeric:tabular-nums;}
.nw-proof-stats span{padding:2px 6px;border-radius:8px;background:rgba(255,255,255,.055);}
.nw-proof-add{color:#a9c3a1;}
.nw-proof-del{color:#d9a08e;}
.nw-proof-chg{color:#e0bd7d;}
.nw-proof-stats em{font-style:normal;color:rgba(236,227,213,.5);font-size:10px;}
.nw-proof-close{
  width:28px;height:28px;margin-left:2px;border:1px solid transparent;border-radius:7px;
  background:transparent;color:rgba(236,227,213,.7);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
}
.nw-proof-close:hover{background:rgba(255,255,255,.07);color:#fff8ec;}

.nw-proof-body{display:grid;grid-template-columns:180px minmax(0,1fr) 246px;flex:1 1 auto;min-height:0;}
.nw-proof-rail{
  min-height:0;overflow:auto;padding:14px 10px;
  border-right:1px solid rgba(236,227,213,.1);
  background:rgba(0,0,0,.08);
}
.nw-proof-railhead{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(236,227,213,.5);padding:0 6px 8px;}
.nw-proof-railhint{margin:0 6px 10px;font-size:9.5px;line-height:1.5;color:rgba(236,227,213,.42);}
.nw-proof-folios{display:flex;flex-direction:column;gap:3px;}
.nw-proof-folio{
  display:flex;flex-direction:column;gap:2px;width:100%;padding:7px 8px;
  border:1px solid transparent;border-radius:8px;
  background:transparent;color:#e9dfcf;font:inherit;text-align:left;cursor:pointer;
}
.nw-proof-folio:hover{background:rgba(255,255,255,.055);}
.nw-proof-folio.is-left{border-color:rgba(230,190,125,.42);background:rgba(230,190,125,.08);}
.nw-proof-folio.is-right{border-color:rgba(151,186,156,.4);}
.nw-proof-folio-no{font-size:11.5px;font-weight:500;}
.nw-proof-folio-meta{font-size:9.5px;color:rgba(236,227,213,.48);font-variant-numeric:tabular-nums;}
.nw-proof-folio .nw-folio-seal{position:absolute;display:inline-flex;}
.nw-proof-foliolive{margin-top:8px;border-top:1px solid rgba(236,227,213,.1);border-radius:0 0 8px 8px;}

.nw-proof-stage{display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(0,0,0,.04);}
.nw-proof-pageheads{
  display:grid;grid-template-columns:1fr 1fr;flex:0 0 auto;
  border-bottom:1px solid rgba(236,227,213,.12);
  background:rgba(255,255,255,.025);
}
.nw-proof-pagehead{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:8px 12px;min-width:0;border-right:1px solid rgba(236,227,213,.09);
}
.nw-proof-pagehead:last-child{border-right:0;}
.nw-proof-pageheadtext{display:flex;flex-direction:column;line-height:1.3;min-width:0;}
.nw-proof-pageheadtext strong{font-size:12.5px;font-weight:600;color:#f0e5d4;white-space:nowrap;}
.nw-proof-pageheadtext span{font-size:9.5px;color:rgba(236,227,213,.48);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nw-proof-pageacts{display:flex;align-items:center;gap:8px;flex:0 0 auto;}
.nw-proof-smallbtn{
  border:1px solid rgba(236,227,213,.18);border-radius:6px;padding:3px 7px;
  background:transparent;color:rgba(236,227,213,.78);font:inherit;font-size:10.5px;cursor:pointer;
}
.nw-proof-smallbtn:hover{border-color:rgba(230,190,125,.5);color:#f4e8d5;}
.nw-proof-livebadge{font-size:9.5px;color:rgba(236,227,213,.45);}

.nw-proof-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;background:#e4d8c6;}
.nw-proof-grid{
  position:relative;min-height:100%;min-width:560px;box-sizing:border-box;
  padding-bottom:56px;background:#f3eadb;color:#2d251e;
}
.nw-proof-grid::after{
  content:'';position:absolute;top:0;bottom:0;left:calc(50% - 9px);width:18px;
  background:linear-gradient(90deg,transparent,rgba(75,58,40,.07) 38%,rgba(75,58,40,.15) 50%,rgba(75,58,40,.07) 62%,transparent);
  pointer-events:none;
}
.nw-proof-row{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(75,58,40,.08);}
.nw-proof-page{
  display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px;
  padding:1px 10px 1px 0;min-height:1.8em;
  /* Both pages reserve the gutter stroke so identical prose wraps on the
     same character. Only the first page paints it. */
  border-right:1px solid transparent;
}
.nw-proof-page:first-child{border-right-color:rgba(75,58,40,.1);}
.nw-proof-no{
  padding-top:.18em;text-align:right;font-size:9.5px;color:rgba(65,48,32,.38);
  font-variant-numeric:tabular-nums;user-select:none;
}
.nw-proof-line{
  white-space:pre-wrap;overflow-wrap:anywhere;
  font-family:Georgia,"Songti SC","SimSun",serif;font-size:14.5px;line-height:1.8;
}
.nw-proof-row.is-changed .nw-proof-page{background:rgba(201,154,58,.16);}
.nw-proof-row.is-left .nw-proof-page:first-child{background:rgba(168,73,53,.13);}
.nw-proof-row.is-left .nw-proof-page:last-child{background:rgba(75,58,40,.035);}
.nw-proof-row.is-right .nw-proof-page:last-child{background:rgba(79,125,85,.14);}
.nw-proof-row.is-right .nw-proof-page:first-child{background:rgba(75,58,40,.035);}
.nw-proof-page.is-empty{background:rgba(75,58,40,.025);}
.nw-proof-mark{
  background:rgba(201,154,58,.42);color:inherit;border-radius:2px;
  box-shadow:0 1px 0 rgba(160,116,44,.55) inset;padding:0 1px;
}
.nw-proof-state{padding:36px;text-align:center;color:rgba(236,227,213,.72);font-size:12px;}
.nw-proof-state.is-error{color:#e5b3a4;}
.nw-proof-truncated{padding:12px 16px;font-size:10px;color:rgba(236,227,213,.55);text-align:center;}

.nw-proof-notes{
  min-height:0;overflow:auto;padding:14px 11px;
  border-left:1px solid rgba(236,227,213,.1);
  background:rgba(0,0,0,.08);
}
.nw-proof-noteshead{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(236,227,213,.5);margin-bottom:9px;}
.nw-proof-notelist{display:flex;flex-direction:column;gap:4px;}
.nw-proof-note{
  display:flex;flex-direction:column;gap:2px;width:100%;padding:7px 8px;
  border:1px solid transparent;border-left:2px solid rgba(230,190,125,.45);
  background:rgba(255,255,255,.025);color:#e6dac8;font:inherit;text-align:left;cursor:pointer;
}
.nw-proof-note:hover{background:rgba(255,255,255,.06);border-left-color:#e6be7d;}
.nw-proof-noteno{font-size:9px;color:rgba(236,227,213,.42);}
.nw-proof-notetext{font-size:10.5px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nw-proof-notecount{font-size:9px;color:rgba(230,190,125,.68);}
.nw-proof-notesempty{font-size:10.5px;line-height:1.6;color:rgba(236,227,213,.45);}
.nw-proof-notesfoot{margin-top:14px;padding-top:10px;border-top:1px solid rgba(236,227,213,.09);font-size:9.5px;color:rgba(236,227,213,.38);}

@keyframes nw-folio-in{from{opacity:0;transform:translateX(18px);}to{opacity:1;transform:none;}}
@keyframes nw-folio-up{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:none;}}
@keyframes nw-folio-fade{from{opacity:0;}to{opacity:1;}}

@media (max-width:980px){
  .nw-proof-body{grid-template-columns:150px minmax(0,1fr) 210px;}
  .nw-proof-select{max-width:118px;}
  .nw-proof-title strong{max-width:150px;}
}
@media (max-width:760px){
  .nw-proof-head{flex-wrap:wrap;gap:8px;padding:8px 10px;}
  .nw-proof-selects{order:4;width:100%;margin-left:0;}
  .nw-proof-select{flex:1 1 auto;max-width:none;}
  .nw-proof-body{grid-template-columns:minmax(0,1fr);}
  .nw-proof-rail,.nw-proof-notes{display:none;}
  .nw-proof-pageheads{display:none;}
  .nw-proof-grid{min-width:640px;}
  .nw-proof-stats{gap:5px;font-size:10px;}
  .nw-folio{top:8px;right:8px;}
  .nw-folio-capture{max-width:84px;opacity:1;padding:0 8px;border-color:color-mix(in srgb,var(--nw-brand) 24%,transparent);}
  .nw-folio-capture span{display:inline;}
  .nw-folio-scrim{position:fixed;}
  .nw-folio-drawer{
    position:fixed;top:auto;left:0;right:0;bottom:0;width:auto;max-width:none;
    max-height:82vh;max-height:82dvh;
    border-left:0;border-top:1px solid var(--nw-line-soft);border-radius:15px 15px 0 0;
    animation-name:nw-folio-up;
  }
  .nw-folio-head{padding-top:15px;}
  .nw-folio-readpaper{padding:30px 18px 70px;max-width:none !important;}
  .nw-folio-readbar{min-height:42px;padding:6px 10px;}
  .nw-folio-readmeta{flex:1 1 100%;order:2;}
  .nw-folio-readacts{margin-left:0;order:3;width:100%;gap:14px;}
}
/* R177: the proof desk is a view of the manuscript, so it must wear the same
   palette as the editor. Every surface below is derived from the live theme
   tokens; the old fixed brown desk is gone. */
.nw-proof{
  color:var(--nw-fg);
  background-color:var(--nw-bg);
  background-image:none;
}
.nw-proof-head{background:var(--nw-panel);border-bottom-color:var(--nw-rule);}
.nw-proof-back,.nw-proof-close{color:var(--nw-fg-soft);}
.nw-proof-back:hover,.nw-proof-close:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-proof-title span{color:var(--nw-fg-soft);}
.nw-proof-title strong{color:var(--nw-fg);}
.nw-proof-select{
  border-color:var(--nw-line-strong);background:var(--nw-bg);color:var(--nw-fg);
}
.nw-proof-select:focus{border-color:var(--nw-brand);}
.nw-proof-select option{background:var(--nw-panel);color:var(--nw-fg);}
.nw-proof-swap{border-color:var(--nw-line-strong);color:var(--nw-fg-soft);}
.nw-proof-swap:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-proof-stats span{background:var(--nw-sunken);}
.nw-proof-stats em{color:var(--nw-fg-soft);}
.nw-proof-body{background:var(--nw-bg);}
.nw-proof-rail,.nw-proof-notes{
  border-color:var(--nw-rule);background:color-mix(in srgb,var(--nw-bg) 88%,var(--nw-fg));
}
.nw-proof-railhead,.nw-proof-noteshead{color:var(--nw-fg-soft);}
.nw-proof-railhint,.nw-proof-notesfoot{color:var(--nw-fg-soft);}
.nw-proof-folio{color:var(--nw-fg);}
.nw-proof-folio:hover{background:var(--nw-sunken);}
.nw-proof-folio.is-left{border-color:color-mix(in srgb,var(--nw-brand) 48%,transparent);background:color-mix(in srgb,var(--nw-brand) 7%,transparent);}
.nw-proof-folio.is-right{border-color:color-mix(in srgb,var(--nw-ok) 45%,transparent);}
.nw-proof-folio-meta{color:var(--nw-fg-soft);}
.nw-proof-foliolive{border-top-color:var(--nw-rule);}
.nw-proof-stage{background:var(--nw-bg);}
.nw-proof-pageheads{border-bottom-color:var(--nw-rule);background:var(--nw-panel);}
.nw-proof-pagehead{border-right-color:var(--nw-rule);}
.nw-proof-pageheadtext strong{color:var(--nw-fg);}
.nw-proof-pageheadtext span{color:var(--nw-fg-soft);}
.nw-proof-smallbtn{border-color:var(--nw-line-strong);color:var(--nw-fg-soft);}
.nw-proof-smallbtn:hover{border-color:var(--nw-brand);color:var(--nw-fg);}
.nw-proof-livebadge{color:var(--nw-fg-soft);}
.nw-proof-scroll{background:var(--nw-bg);}
.nw-proof-grid{background:color-mix(in srgb,var(--nw-panel) 95%,var(--nw-fg) 5%);color:var(--nw-fg);box-shadow:0 0 0 1px var(--nw-rule),0 20px 50px color-mix(in srgb,var(--nw-fg) 8%,transparent);}
.nw-proof-grid::after{
  background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--nw-fg) 5%,transparent) 38%,color-mix(in srgb,var(--nw-fg) 11%,transparent) 50%,color-mix(in srgb,var(--nw-fg) 5%,transparent) 62%,transparent);
}
.nw-proof-row{border-bottom-color:var(--nw-rule);}
.nw-proof-page:first-child{border-right-color:var(--nw-rule);}
.nw-proof-no{color:var(--nw-fg-soft);}
.nw-proof-row.is-changed .nw-proof-page{background:color-mix(in srgb,var(--nw-brand) 12%,transparent);}
.nw-proof-row.is-left .nw-proof-page:first-child{background:color-mix(in srgb,var(--nw-danger) 12%,transparent);}
.nw-proof-row.is-right .nw-proof-page:last-child{background:color-mix(in srgb,var(--nw-ok) 12%,transparent);}
.nw-proof-page.is-empty{background:color-mix(in srgb,var(--nw-fg) 2.5%,transparent);}
.nw-proof-mark{background:color-mix(in srgb,var(--nw-brand) 28%,transparent);box-shadow:none;}
.nw-proof-state{color:var(--nw-fg-soft);}
.nw-proof-state.is-error{color:var(--nw-danger);}
.nw-proof-truncated{color:var(--nw-fg-soft);}
.nw-proof-note{background:var(--nw-panel);color:var(--nw-fg);border-left-color:color-mix(in srgb,var(--nw-brand) 40%,transparent);}
.nw-proof-note:hover{background:var(--nw-sunken);border-left-color:var(--nw-brand);}
.nw-proof-noteno,.nw-proof-notesempty{color:var(--nw-fg-soft);}
.nw-proof-notecount{color:var(--nw-brand);}
.nw-proof-notesfoot{border-top-color:var(--nw-rule);}

@media (prefers-reduced-motion:reduce){
  .nw-folio-drawer,.nw-folio-read,.nw-proof{animation:none;}
  .nw-folio-capture{transition:none;}
}
`);

})();
