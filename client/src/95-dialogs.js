;(() => {
  'use strict';

  const { useState, useEffect, useRef, useCallback, useMemo } = React;

  NW.dialogs = {};

  function errText(err, fallback) {
    if (!err) return fallback || '操作失败';
    const msg = err && err.message ? String(err.message) : String(err);
    const base = msg || fallback || '操作失败';
    // R34: when every model was tried, the host's message for the last one is
    // rarely the whole story — name the models so 「失败了」 becomes actionable.
    const tried = err && Array.isArray(err.tried) ? err.tried : null;
    if (!tried || !tried.length) return base;
    const names = tried
      .slice(0, 3)
      .map((row) => String((row && row.label) || '').trim())
      .filter(Boolean);
    if (!names.length) return base;
    return base + '（已尝试：' + names.join('、') + (tried.length > 3 ? ' 等 ' + tried.length + ' 个模型' : '') + '）';
  }

  /** Current editor text (falls back to the stored chapter body). */
  function textOf(props) {
    const p = props || {};
    if (typeof p.getText === 'function') {
      try {
        const value = p.getText();
        if (value != null) return String(value);
      } catch (err) {
        /* fall through */
      }
    }
    return String((p.chapter && p.chapter.content) || '');
  }

  function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /**
   * Shared dialog chrome. Owns the two dismissal affordances every modal needs:
   * Escape, and a click on the mask outside the panel. Without these a dialog
   * can only be closed via its own button, which strands the user when that
   * button scrolls out of view and leaves every control underneath blocked.
   */
  function ModalShell(props) {
    const { title, children, footer, width, onClose } = props;
    NW.useModalEscape(typeof onClose === 'function', onClose);
    const onPointerDown = (ev) => {
      if (ev.target === ev.currentTarget && typeof onClose === 'function') onClose();
    };
    return h(
      'div',
      { className: 'nw-modal-mask', role: 'presentation', onPointerDown: onPointerDown },
      h(
        'div',
        { className: 'nw-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { maxWidth: width } : undefined },
        h('div', { className: 'nw-modal-head' }, h('h2', null, title)),
        h('div', { className: 'nw-modal-body' }, children),
        footer ? h('div', { className: 'nw-modal-foot' }, footer) : null,
      ),
    );
  }

  function modal(title, children, footer, width, onClose) {
    return h(ModalShell, { title: title, children: children, footer: footer, width: width, onClose: onClose });
  }

  function closeBtn(props) {
    return NW.ui.btn({ onClick: props.onClose, children: NW.t('关闭') });
  }

  // ================================================== shared dialog atoms ====
  // NW.ui deliberately stays small; these cover the controls the newer panels
  // need and it does not expose: a real range slider (NW.ui.input drops
  // min/max/step), a collapsed fold, a badge, and a theme chip with a swatch.

  function rangeInput(props) {
    const p = props || {};
    return h('input', {
      type: 'range',
      className: 'nw-input nw-range',
      value: p.value == null ? 0 : p.value,
      min: p.min == null ? 0 : p.min,
      max: p.max == null ? 100 : p.max,
      step: p.step == null ? 1 : p.step,
      style: p.style || { padding: 0, width: '100%' },
      'aria-label': p.ariaLabel || p.label || undefined,
      onChange: (ev) => {
        const raw = ev && ev.target ? ev.target.value : 0;
        if (typeof p.onChange === 'function') p.onChange(Number(raw));
      },
    });
  }

  /**
   * Segmented control. Prefers the shared NW.ui.seg atom and degrades to the
   * same markup hand-built, so this file keeps working even if the atom is
   * missing from an older build of the host bundle.
   */
  function segControl(props) {
    const p = props || {};
    if (NW.ui && typeof NW.ui.seg === 'function') return NW.ui.seg(p);
    return h(
      'div',
      { className: 'nw-seg', role: 'group', 'aria-label': p.ariaLabel || undefined },
      (p.options || []).map((opt) =>
        NW.ui.btn({
          key: String(opt.value),
          kind: p.value === opt.value ? 'primary' : 'default',
          onClick: () => {
            if (typeof p.onChange === 'function') p.onChange(opt.value);
          },
          children: opt.label,
        }),
      ),
    );
  }

  function foldBox(props) {
    const p = props || {};
    const open = !!p.open;
    return h(
      'div',
      { className: 'nw-fold' + (open ? ' nw-fold-open' : '') },
      h(
        'div',
        { className: 'nw-fold-head' },
        NW.ui.btn({
          kind: 'ghost',
          onClick: () => {
            if (typeof p.onToggle === 'function') p.onToggle(!open);
          },
          children: (open ? '\u25be ' : '\u25b8 ') + String(p.title || ''),
        }),
        p.extra || null,
      ),
      open ? h('div', { className: 'nw-fold-body' }, p.children) : null,
    );
  }

  function badge(text, kind) {
    return h('span', { className: 'nw-badge', 'data-kind': kind || 'info' }, String(text));
  }

  /**
   * R16 ⑩: 期刊水平等级 chip. The code comes from the host (`tierOfTags`), the
   * label is localised here so the same code can render in either language.
   */
  const TIER_TEXT = {
    national: '国家级',
    provincial: '省级',
    municipal: '市级',
    other: '其他',
  };

  const TIER_KIND = {
    national: 'brand',
    provincial: 'ok',
    municipal: 'info',
    other: 'info',
  };

  function tierBadge(tier) {
    const code = String(tier || 'other');
    return badge(NW.t(TIER_TEXT[code] || TIER_TEXT.other), TIER_KIND[code] || 'info');
  }

  /**
   * Theme chip: a colour swatch plus its label. The actual colours live in the
   * stylesheet (data-theme-swatch attributes), so this stays theme-agnostic.
   */
  function themeChoice(entry, active, onPick) {
    return h(
      'button',
      {
        key: entry.value,
        type: 'button',
        className: 'nw-choice' + (active ? ' nw-choice-on' : ''),
        onClick: () => {
          if (typeof onPick === 'function') onPick(entry.value);
        },
        'aria-pressed': active ? 'true' : 'false',
        title: entry.label,
      },
      h('span', {
        className: 'nw-theme-swatch',
        'data-theme-swatch': entry.value,
        'data-theme': entry.value,
        'data-value': entry.value,
        // The stylesheet keys the active ring off the swatch itself, not the
        // surrounding chip, so mirror the state here too.
        'data-active': active ? '1' : '0',
        'aria-checked': active ? 'true' : 'false',
      }),
      h('span', { className: 'nw-choice-label' }, entry.label),
    );
  }

  /** Open a sibling dialog when the host wires it, else report honestly. */
  function openSibling(props, kind, extra) {
    const p = props || {};
    if (typeof p.onOpenDialog === 'function') {
      p.onOpenDialog(kind, extra || {});
      return true;
    }
    if (kind === 'backup' && typeof p.onOpenBackup === 'function') {
      if (typeof p.onClose === 'function') p.onClose();
      p.onOpenBackup();
      return true;
    }
    if (typeof p.onToast === 'function') p.onToast('当前版本还不支持从设置里打开这个面板', 'info');
    return false;
  }

  /**
   * One-line description of the autosave state, shown in Settings so the row
   * still answers "is my work being written to disk?" without duplicating the
   * controls that live in the Backup dialog.
   */
  function summaryOf(lib) {
    const state = lib || {};
    if (!state.dir) return lib && lib.busy ? String(lib.busy) : '未选择保存文件夹';
    const parts = [state.mirror === true ? '自动保存开' : '自动保存关', state.encrypt === true ? '加密 .nwe' : '明文'];
    return parts.join(' · ');
  }

  // ---------------------------------------------------------- shared data ----

  // Five themes (R19). Order is deliberate: the two neutral papers first, then
  // the one dark palette, then the two that carry a strong editorial voice.
  const THEME_OPTIONS = [
    { value: 'claude', label: '浅色' },
    { value: 'eye', label: '护眼' },
    { value: 'night', label: '深色' },
    { value: 'newspaper', label: '报纸' },
    { value: 'magazine', label: '杂志' },
  ];

  /**
   * Settings sections, in render order. The order here IS the order of the
   * `section(...)` calls in NW.dialogs.Settings — the helper assigns `data-tab`
   * by call index, which is what keeps a 2000-line single-file dialog from
   * needing six duplicated wrappers.
   */
  const SETTINGS_TABS = [
    { id: 'appearance', label: '外观', icon: 'sun' },
    { id: 'writing', label: '写作', icon: 'typewriter' },
    { id: 'export', label: '导出与文件', icon: 'download' },
    { id: 'privacy', label: '隐私与锁定', icon: 'lock' },
    { id: 'submit', label: '投稿', icon: 'mail' },
    { id: 'lan', label: '手机同步', icon: 'refresh' },
    { id: 'keys', label: '快捷键', icon: 'keyboard' },
  ];

  /** Contract §11: 微小说 / 短篇 / 中篇 / 长篇 with the same cut points as the host. */
  const GENRE_OPTIONS = [
    { value: 'weixiaoshuo', label: '微小说', min: 0, max: 2000 },
    { value: 'duanpian', label: '短篇小说', min: 2000, max: 20000 },
    { value: 'zhongpian', label: '中篇小说', min: 20000, max: 100000 },
    { value: 'changpian', label: '长篇小说', min: 100000, max: -1 },
  ];

  function genreLabelOf(value) {
    for (let i = 0; i < GENRE_OPTIONS.length; i += 1) {
      if (GENRE_OPTIONS[i].value === value) return GENRE_OPTIONS[i].label;
    }
    return '小说';
  }

  function suggestGenreOf(count) {
    const n = Number(count) || 0;
    if (n < 2000) return 'weixiaoshuo';
    if (n < 20000) return 'duanpian';
    if (n < 100000) return 'zhongpian';
    return 'changpian';
  }

  /**
   * Character count matching the host's countChars().
   *
   * R16 ⑥: both halves honour the 标点 setting now. This used to strip
   * whitespace only while NW.format.wordCount also skipped punctuation, which is
   * why the same manuscript read as two different lengths on the home screen and
   * in the submission preview.
   */
  function countCharsOf(text) {
    try {
      const body = String(text == null ? '' : text).replace(/\s/g, '');
      const withPunctuation =
        NW.format && typeof NW.format.includePunctuation === 'function'
          ? NW.format.includePunctuation()
          : true;
      if (!withPunctuation) return Array.from(body.replace(/[\p{P}\p{S}]/gu, '')).length;
      return Array.from(body).length;
    } catch (err) {
      return 0;
    }
  }

  // ---- R6 ④: per-genre / per-length inboxes ---------------------------------
  // One journal can list several addresses ("短篇投 a@x.com，长篇投 b@x.com").
  // The editor exposes them as one line each so nothing needs a nested form:
  //   收件邮箱 | 体裁(逗号分隔) | 字数范围 或 short/medium/long | 备注
  // Everything except the address is optional; an empty filter means "any".
  const EMAIL_GENRE_KEYS = {
    微小说: 'weixiaoshuo',
    短篇: 'duanpian',
    短篇小说: 'duanpian',
    中篇: 'zhongpian',
    中篇小说: 'zhongpian',
    长篇: 'changpian',
    长篇小说: 'changpian',
    weixiaoshuo: 'weixiaoshuo',
    duanpian: 'duanpian',
    zhongpian: 'zhongpian',
    changpian: 'changpian',
  };
  const EMAIL_GENRE_LABELS = {
    weixiaoshuo: '微小说',
    duanpian: '短篇',
    zhongpian: '中篇',
    changpian: '长篇',
  };
  // R10 ⑥: the host keeps four length bands (weixiaoshuo / duanpian / zhongpian
  // / changpian). The old three-band spellings are still accepted so a line
  // typed before this change keeps matching, but they are mapped onto the four
  // canonical slugs — writing band:'short' would never match again.
  const EMAIL_BAND_KEYS = {
    weixiaoshuo: 'weixiaoshuo',
    微小说: 'weixiaoshuo',
    duanpian: 'duanpian',
    短篇: 'duanpian',
    短篇小说: 'duanpian',
    zhongpian: 'zhongpian',
    中篇: 'zhongpian',
    中篇小说: 'zhongpian',
    changpian: 'changpian',
    长篇: 'changpian',
    长篇小说: 'changpian',
    short: 'duanpian',
    medium: 'zhongpian',
    long: 'changpian',
  };
  const EMAIL_BAND_LABELS = { weixiaoshuo: '微小说', duanpian: '短篇', zhongpian: '中篇', changpian: '长篇' };

  /**
   * R32 ②: one editable row per inbox. Kept deliberately close to the shape the
   * host stores so variantFromRow() is a straight read, not a re-parse.
   */
  function variantRowsOf(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && String(row.email || '').indexOf('@') > 0)
      .map((row) => ({
        email: String(row.email || ''),
        genres: Object.keys(row.genres || {}).filter((key) => row.genres[key]),
        range: Number(row.minWords) || Number(row.maxWords)
          ? String(Number(row.minWords) || 0) + '-' + String(Number(row.maxWords) || 0)
          : '',
        note: String(row.note || ''),
      }));
  }

  function variantFromRow(row) {
    if (!row) return null;
    const email = String(row.email || '').trim();
    if (email.indexOf('@') <= 0) return null;
    const genres = {};
    (Array.isArray(row.genres) ? row.genres : []).forEach((key) => {
      if (EMAIL_GENRE_KEYS[key]) genres[EMAIL_GENRE_KEYS[key]] = true;
    });
    const nums = String(row.range || '').replace(/字|words?/gi, '').match(/\d+/g) || [];
    let minWords = 0;
    let maxWords = 0;
    if (nums.length >= 2) {
      minWords = Number(nums[0]) || 0;
      maxWords = Number(nums[1]) || 0;
      if (minWords > maxWords) {
        const swap = minWords;
        minWords = maxWords;
        maxWords = swap;
      }
    } else if (nums.length === 1) {
      minWords = Number(nums[0]) || 0;
    }
    return {
      email: email,
      genres: genres,
      band: '',
      minWords: minWords,
      maxWords: maxWords,
      note: String(row.note || '').trim(),
    };
  }

  /**
   * R32 ②: one bordered block per inbox, shared by 期刊库 and the wizard's inline
   * 编辑期刊信息 form. Keeping a single implementation matters — the two places
   * drifted apart before, and only one of them learned about multiple addresses.
   *
   * handlers: { setRow(index, patch), addRow(), removeRow(index), toggleGenre(list, value) }
   */
  function emailRowEditor(rows, handlers) {
    const list = Array.isArray(rows) ? rows : [];
    const addRow = handlers && handlers.addRow;
    return NW.React.createElement(
      'div',
      { className: 'nw-field' },
      NW.React.createElement('label', null, '按体裁 / 篇幅分列的收稿邮箱'),
      NW.React.createElement(
        'span',
        { className: 'nw-hint' },
        '这家刊有几个收稿邮箱就登记几行。体裁和字数都不填 = 任何稿件都能投这个地址。',
      ),
      list.length === 0
        ? NW.React.createElement('div', { className: 'nw-dim', style: { padding: '6px 0' } }, '还没有分列邮箱。')
        : NW.React.createElement(
            'div',
            { className: 'nw-emailrows' },
            list.map((row, index) =>
              NW.React.createElement(
                'div',
                { key: 'emailrow-' + String(index), className: 'nw-emailrow' },
                NW.ui.input({
                  value: row.email,
                  placeholder: '收稿邮箱',
                  ariaLabel: '第 ' + String(index + 1) + ' 个收稿邮箱',
                  onChange: (v) => handlers.setRow(index, { email: v }),
                }),
                NW.React.createElement(
                  'div',
                  { className: 'nw-emailrow-tags' },
                  GENRE_OPTIONS.map((option) =>
                    NW.React.createElement(
                      'button',
                      {
                        key: 'g-' + String(index) + '-' + option.value,
                        type: 'button',
                        className: 'nw-emailrow-chip',
                        'data-on': row.genres.indexOf(option.value) >= 0 ? '1' : '0',
                        'aria-pressed': row.genres.indexOf(option.value) >= 0 ? 'true' : 'false',
                        onClick: () => handlers.setRow(index, { genres: handlers.toggleGenre(row.genres, option.value) }),
                      },
                      option.label,
                    ),
                  ),
                ),
                NW.React.createElement(
                  'div',
                  { className: 'nw-emailrow-side' },
                  NW.ui.input({
                    value: row.range,
                    placeholder: '字数 如 5000-30000',
                    ariaLabel: '第 ' + String(index + 1) + ' 个邮箱的字数范围',
                    onChange: (v) => handlers.setRow(index, { range: v }),
                  }),
                  NW.ui.btn({
                    kind: 'ghost',
                    onClick: () => handlers.removeRow(index),
                    title: '删除这个邮箱',
                    ariaLabel: '删除第 ' + String(index + 1) + ' 个收稿邮箱',
                    children: '删除',
                  }),
                ),
                NW.ui.input({
                  value: row.note,
                  placeholder: '备注（例如：只收中长篇；请在邮件主题注明篇幅）',
                  ariaLabel: '第 ' + String(index + 1) + ' 个邮箱的备注',
                  onChange: (v) => handlers.setRow(index, { note: v }),
                }),
              ),
            ),
          ),
      addRow
        ? NW.React.createElement(
            'div',
            { className: 'nw-inline', style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
            NW.ui.btn({ onClick: addRow, children: '＋ 添加一个收稿邮箱' }),
          )
        : null,
    );
  }

  /**
   * R32: flatten one journal into display lines — the default inbox first, then
   * each per-体裁 address with its own filter summary.
   */
  function journalMailLines(entry) {
    const safe = entry || {};
    const lines = [];
    const main = String(safe.email || '').trim();
    if (main) lines.push({ email: main, tags: '', main: true });
    const variants = Array.isArray(safe.emails) ? safe.emails : [];
    variants.forEach((row) => {
      const email = String((row && row.email) || '').trim();
      if (!email) return;
      const tags = [];
      const genres = Object.keys((row && row.genres) || {})
        .filter((key) => row.genres[key])
        .map((key) => EMAIL_GENRE_LABELS[key] || key);
      if (genres.length) tags.push(genres.join('/'));
      if (Number(row.minWords) || Number(row.maxWords)) {
        tags.push(String(Number(row.minWords) || 0) + '-' + String(Number(row.maxWords) || 0) + ' 字');
      } else if (row.band) {
        tags.push(EMAIL_BAND_LABELS[row.band] || String(row.band));
      }
      if (row.note) tags.push(String(row.note));
      lines.push({ email: email, tags: tags.join(' · '), main: false });
    });
    if (lines.length === 0) lines.push({ email: '未收录邮箱', tags: '', main: true });
    return lines;
  }

  /**
   * R6 ⑤: many journals dictate the mail subject ("投稿类型+题目+字数").
   * We cannot know every rule, but when the journal's own submission
   * requirements mention the subject/heading we echo that line verbatim
   * under the subject box instead of silently guessing.
   */
  function subjectRuleOf(prepared) {
    if (!prepared) return '';
    const journal = prepared.journal || {};
    const lines = []
      .concat(Array.isArray(journal.requirements) ? journal.requirements : [])
      .concat(Array.isArray(prepared.requirements) ? prepared.requirements : []);
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] == null ? '' : lines[i]).trim();
      if (!line) continue;
      if (/主题|标题|邮件题|题名/.test(line) && /格式|写明|注明|请|须|需|要求|：|:/.test(line)) return '该刊要求：' + line;
    }
    return '';
  }

  function textOfChapter(chapter) {
    if (!chapter) return '';
    return String(chapter.content == null ? '' : chapter.content);
  }

  /** Human label for an export format code (settings rows read this back). */
  function formatLabelOf(value) {
    const code = String(value || 'docx');
    if (code === 'pdf') return 'PDF';
    if (code === 'epub') return 'EPUB';
    if (code === 'txt') return '纯文本 (.txt)';
    return 'Word (.docx)';
  }

  // =========================================================== Lock screen ===
  NW.dialogs.Lock = function Lock(props) {
    const p = props || {};
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
      if (!password) {
        setError(NW.t('输入密码'));
        return;
      }
      setBusy(true);
      setError('');
      try {
        const ok = await p.onUnlock(password);
        if (!ok) {
          setError(NW.t('密码错误'));
          setPassword('');
        }
      } catch (err) {
        setError(errText(err, '解锁失败'));
      } finally {
        setBusy(false);
      }
    };

    return h(
      'div',
      { className: 'nw-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': NW.t('锁定') },
      h(
        'div',
        { className: 'nw-lock-card' },
        h(NW.SidebarIcon, { size: 34 }),
        h('h2', { className: 'nw-lock-title' }, NW.t('精神空间') + ' · ' + NW.t('锁定')),
        h('p', { className: 'nw-lock-hint' }, '输入密码以解锁你的书房。'),
        h('input', {
          className: 'nw-input nw-lock-input',
          type: 'password',
          value: password,
          autoFocus: true,
          placeholder: NW.t('输入密码'),
          'aria-label': NW.t('密码'),
          onChange: (ev) => setPassword(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              submit();
            }
          },
        }),
        error ? h('div', { className: 'nw-lock-error', role: 'alert' }, error) : null,
        h(
          'div',
          { className: 'nw-lock-actions' },
          NW.ui.btn({ kind: 'primary', onClick: submit, disabled: busy, children: NW.t('解锁') }),
          p.onClose ? NW.ui.btn({ onClick: p.onClose, children: NW.t('取消') }) : null,
        ),
        busy ? NW.ui.spinner('') : null,
      ),
    );
  };

  // ========================================================== Lock setup ====
  NW.dialogs.LockSetup = function LockSetup(props) {
    const p = props || {};
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
      if (!pw1 || pw1.length < 4) {
        setError('密码至少 4 位');
        return;
      }
      if (pw1 !== pw2) {
        setError('两次输入的密码不一致');
        return;
      }
      setBusy(true);
      setError('');
      try {
        // Route through the app so it can turn encryption on, seal what is
        // already stored, and enter the locked state right away. Setting the
        // password alone used to leave the studio wide open and plaintext on
        // disk — see NW.App lockAfterSetup().
        if (typeof p.onLockSetup === 'function') {
          const sealed = await p.onLockSetup(pw1);
          if (typeof p.onToast === 'function') p.onToast(
            sealed > 0 ? '密码已设置，' + sealed + ' 段正文已加密，书房已上锁' : '密码已设置，书房已上锁',
            'ok',
          );
        } else {
          await NW.crypto.setPassword(pw1);
          if (typeof p.onSettings === 'function') await p.onSettings({ lockEnabled: true, encryption: true });
          await NW.db.encryptAll();
          NW.crypto.lock();
          if (typeof p.onToast === 'function') p.onToast('密码已设置，书房已加密保护', 'ok');
        }
        if (typeof p.onClose === 'function') p.onClose();
      } catch (err) {
        setError(errText(err, '设置密码失败'));
      } finally {
        setBusy(false);
      }
    };

    return modal(
      NW.t('设置密码'),
      h(
        'div',
        null,
        h('p', { className: 'nw-hint-block' }, '设置后，锁定时正文以 AES-256-GCM 加密保存；关闭 DSH 再打开也需要密码才能解锁。'),
        NW.ui.field({ label: NW.t('密码'), children: NW.ui.input({ type: 'password', value: pw1, onChange: setPw1, autoFocus: true }) }),
        NW.ui.field({ label: '确认密码', children: NW.ui.input({ type: 'password', value: pw2, onChange: setPw2 }) }),
        error ? h('div', { className: 'nw-lock-error', role: 'alert' }, error) : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        closeBtn(p),
        NW.ui.btn({ kind: 'primary', onClick: submit, disabled: busy, children: NW.t('设置密码') }),
      ),
      '360px',
      p.onClose,
    );
  };

  // ============================================================== Export ====
  NW.dialogs.Export = function Export(props) {
    const p = props || {};
    const settings = p.settings || {};
    const caps = p.capabilities || {};
    const defaults = p.exportDefaults || {};
    const available = ['docx', 'pdf', 'epub', 'txt'].filter((value) => caps[value] !== false);
    const initialFormat = (() => {
      const want = settings.exportFormat || 'docx';
      return available.indexOf(want) >= 0 ? want : available[0] || 'docx';
    })();

    // The chip that opened this dialog carries what to export; falling back to
    // the whole novel keeps the old toolbar entry working unchanged.
    const requested = (p.dialog && p.dialog.target) || p.target || null;
    const novel = p.novel || {};
    const chapter = p.chapter || null;
    const novelTitle = String(novel.title || '未命名小说');
    const defaultTarget =
      requested && (requested.kind === 'chapter' || requested.kind === 'novel')
        ? { kind: requested.kind, id: String(requested.id || ''), title: String(requested.title || '') }
        : chapter
          ? { kind: 'chapter', id: String(chapter.id || ''), title: String(chapter.title || '') }
          : { kind: 'novel', id: String(novel.id || ''), title: novelTitle };

    const [format, setFormat] = useState(initialFormat);
    const [cover, setCover] = useState('');
    const [pageBreaks, setPageBreaks] = useState(true);
    const [includeToc, setIncludeToc] = useState(false);
    // Settings owns the default ("导出包含书名与作者"); an explicit prop wins so
    // the toolbar chip can still force the choice for one export.
    const [includeMeta, setIncludeMeta] = useState(
      typeof defaults.includeMeta === 'boolean'
        ? defaults.includeMeta
        : typeof settings.exportIncludeMeta === 'boolean'
          ? settings.exportIncludeMeta
          : true,
    );
    const [appendOn, setAppendOn] = useState(
      typeof defaults.appendOn === 'boolean' ? defaults.appendOn : !!settings.exportSignatureOn,
    );
    const [appendText, setAppendText] = useState(
      typeof defaults.appendText === 'string'
        ? defaults.appendText
        : String(settings.exportSignature || ''),
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // The target decides everything below: the chapter tree can ask to export a
    // chapter other than the one currently open, and silently exporting the open
    // chapter instead is exactly the bug this branch used to have.
    const hasChapter = !!(defaultTarget.kind === 'chapter' && defaultTarget.id);
    const target = hasChapter ? defaultTarget : { kind: 'novel', id: String(novel.id || ''), title: novelTitle };
    const [scope, setScope] = useState(target.kind === 'chapter' ? 'chapter' : 'novel');

    const APPEND_LIMIT = 8000;
    const trimmedAppend = String(appendText || '').replace(/\r\n|\r/g, '\n');
    const appendTooLong = trimmedAppend.length > APPEND_LIMIT;

    // R14 ①: a short story is one continuous text, so its "chapters" are
    // scaffolding, not structure. Default to continuous when the book has a
    // single chapter — the user can still force chapter headings back on.
    const chapterCount = Array.isArray(p.chapters)
      ? p.chapters.filter((row) => row && String(row.novelId || '') === String(novel.id || '')).length
      : 0;
    const [continuous, setContinuous] = useState(chapterCount <= 1);

    // Chapter titles already read like "第一章 归途", so never wrap them in
    // another "第 … 章" here or the sentence stutters.
    const chapterLabel = String((target.kind === 'chapter' && target.title) || (chapter && chapter.title) || '当前章');
    const headline =
      scope === 'chapter'
        ? '将导出《' + novelTitle + '》的「' + chapterLabel + '」。'
        : '将导出《' + novelTitle + '》的全部章节。';

    const run = async () => {
      setBusy(true);
      setError('');
      try {
        if (typeof p.onExport !== 'function') throw new Error('当前版本还不支持导出');
        const payload = {
          format: format,
          target:
            scope === 'chapter' && hasChapter
              ? { kind: 'chapter', id: String(target.id), title: String(target.title || chapterLabel) }
              : { kind: 'novel', id: String(novel.id || ''), title: novelTitle },
          includeMeta: !!includeMeta,
          appendOn: !!appendOn,
          appendText: appendOn ? trimmedAppend.slice(0, APPEND_LIMIT) : '',
          options: {
            coverBase64: cover || undefined,
            pageBreaks: !!pageBreaks,
            toc: !!includeToc,
            // Legacy spellings the host builders still read directly.
            pageBreak: !!pageBreaks,
            includeToc: !!includeToc,
            includeMeta: !!includeMeta,
            // R14 ①: drop the chapter headings entirely for a single-piece
            // story; `noPlaceholders` keeps real titles but strips 「新章节」.
            continuous: !!continuous,
            noPlaceholders: true,
          },
        };
        await p.onExport(payload);
      } catch (err) {
        setError(errText(err, '导出失败'));
      } finally {
        setBusy(false);
      }
    };

    const pickCover = async () => {
      try {
        const files = await NW.io.pickFiles('image/*');
        const file = files && files[0];
        if (!file) return;
        const buffer = await file.arrayBuffer();
        setCover(NW.io.toBase64(new Uint8Array(buffer)));
      } catch (err) {
        setError(errText(err, '读取封面失败'));
      }
    };

    return modal(
      NW.t('导出'),
      h(
        'div',
        null,
        NW.ui.field({
          label: '导出格式',
          children: segControl({
            ariaLabel: '导出格式',
            value: format,
            onChange: setFormat,
            options: ['docx', 'pdf', 'epub', 'txt']
              .filter((value) => available.indexOf(value) >= 0)
              .map((value) => ({ value: value, label: formatLabelOf(value).replace(/ \(.+\)$/, '') })),
          }),
        }),
        hasChapter
          ? NW.ui.field({
              label: '导出范围',
              children: segControl({
                ariaLabel: '导出范围',
                value: scope,
                onChange: setScope,
                options: [
                  { value: 'novel', label: '整本书' },
                  { value: 'chapter', label: '仅当前章' },
                ],
              }),
            })
          : null,
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '封面图片'),
          h(
            'span',
            { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } },
            cover ? h('span', { className: 'nw-dim' }, '已选择') : h('span', { className: 'nw-dim' }, '可选'),
            NW.ui.btn({ onClick: pickCover, disabled: busy, children: '选择…' }),
            cover ? NW.ui.btn({ kind: 'ghost', onClick: () => setCover(''), children: '清除' }) : null,
          ),
        ),
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '不分章节（短篇连续排版）'),
          NW.ui.toggle({ checked: continuous, onChange: setContinuous, label: '不分章节（短篇连续排版）' }),
        ),
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '章节间分页'),
          NW.ui.toggle({ checked: pageBreaks, onChange: setPageBreaks, label: '章节间分页' }),
        ),
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '生成目录'),
          NW.ui.toggle({ checked: includeToc, onChange: setIncludeToc, label: '生成目录' }),
        ),
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '包含书名与作者'),
          NW.ui.toggle({ checked: includeMeta, onChange: setIncludeMeta, label: '包含书名与作者' }),
        ),
        h(
          'div',
          { className: 'nw-row' },
          h('span', null, '文末追加内容'),
          NW.ui.toggle({ checked: appendOn, onChange: setAppendOn, label: '文末追加内容' }),
        ),
        appendOn
          ? h(
              'div',
              { className: 'nw-signature' },
              NW.ui.textarea({
                value: appendText,
                rows: 4,
                placeholder: '例如：作者署名、联系方式、未完待续说明。这段文字会追加在正文最后。',
                onChange: (v) => setAppendText(v),
                ariaLabel: '文末追加内容',
              }),
              h(
                'div',
                { className: 'nw-dim' },
                (appendTooLong ? '已超出上限，将截断为 ' : '') + '最多 ' + APPEND_LIMIT + ' 字 · 当前 ' + trimmedAppend.length + ' 字',
              ),
            )
          : null,
        format === 'pdf' ? h('p', { className: 'nw-hint-block' }, 'PDF 通过 docx 渲染生成，需要本机 PDF 引擎可用。') : null,
        format === 'txt' && appendOn ? h('p', { className: 'nw-hint-block' }, '纯文本导出的文末追加依赖 Host 支持；若未生效请改用 docx。') : null,
        h('p', { className: 'nw-hint-block' }, headline),
        error ? h('div', { className: 'nw-lock-error', role: 'alert' }, error) : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        closeBtn(p),
        NW.ui.btn({ kind: 'primary', onClick: run, disabled: busy, children: busy ? NW.t('导出') + '…' : NW.t('导出') }),
      ),
      '440px',
      p.onClose,
    );
  };

  // =========================================================== Proofread ====
  NW.dialogs.Proofread = function Proofread(props) {
    const p = props || {};
    const [state, setState] = useState({ loading: false, models: null, error: '', provider: '', model: '' });
    const [suggestions, setSuggestions] = useState(null);
    // The offsets in a suggestion only mean anything against the text they were
    // computed from; a dialog stays open for minutes while the editor keeps
    // accepting keystrokes, so keep the snapshot and refuse a stale apply.
    const sourceRef = useRef('');
    const [decided, setDecided] = useState({});
    const [running, setRunning] = useState(false);
    const [applying, setApplying] = useState(false);

    const loadModels = useCallback(async () => {
      setState((prev) => Object.assign({}, prev, { loading: true, error: '' }));
      try {
        const data = await NW.ai.models();
        const current = (data && data.current) || {};
        const list = (data && data.models) || [];
        const settings = p.settings || {};
        let provider = settings.proofreadProvider || current.provider || (list[0] && list[0].provider) || '';
        let model = settings.proofreadModel || current.model || '';
        const has = (pv, mv) => list.some((row) => row && row.provider === pv && row.id === mv);
        if (!has(provider, model)) {
          const first = list.filter((row) => row && row.provider === provider)[0] || list[0];
          if (first) {
            provider = first.provider;
            model = first.id;
          }
        }
        setState({ loading: false, models: data, error: '', provider: provider, model: model });
      } catch (err) {
        setState({ loading: false, models: null, error: errText(err, '无法获取可用模型'), provider: '', model: '' });
      }
    }, [p.settings]);

    useEffect(() => {
      loadModels();
    }, [loadModels]);

    const modelOptions = useMemo(() => {
      const list = (state.models && state.models.models) || [];
      const current = (state.models && state.models.current) || {};
      const options = list.map((row) => ({
        value: row.provider + '\u0000' + row.id,
        label: (row.name || row.id) + ' · ' + row.provider,
      }));
      // The provider/model the harness itself uses is always a valid target,
      // even when discovery returned nothing for it (some providers expose no
      // model list at all). Surface it so the dialog is never unusable.
      if (current.provider && current.model) {
        const value = current.provider + '\u0000' + current.model;
        if (!options.some((opt) => opt.value === value)) {
          options.unshift({ value: value, label: current.model + ' · ' + current.provider + '（当前默认）' });
        }
      }
      return options;
    }, [state.models]);

    const currentValue = state.provider && state.model ? state.provider + '\u0000' + state.model : '';

    const run = async () => {
      const text = textOf(p);
      if (!text.trim()) {
        setState((prev) => Object.assign({}, prev, { error: '当前章节还没有内容' }));
        return;
      }
      setRunning(true);
      setState((prev) => Object.assign({}, prev, { error: '' }));
      setSuggestions(null);
      setDecided({});
      try {
        // R34: failover — if the chosen model is unreachable the client walks
        // the other configured models, and only then offers the picker. The
        // panel itself stays the writer's explicit choice, so `preferred` wins
        // whenever it works and nothing changes for the happy path.
        const data = await NW.ai.proofreadSafe({
          provider: state.provider,
          model: state.model,
          text: text,
          mode: 'typo',
          // R29: the brief edited in Settings → 写作, if the writer wrote one.
          rules: String((p.settings && p.settings.proofreadRules) || ''),
          onRetry: (candidate) => {
            setState((prev) => Object.assign({}, prev, { error: NW.t('换用 {0} 重试…', candidate.label) }));
          },
        });
        const usedModel = (data && data.usedModel) || null;
        if (usedModel && (usedModel.provider !== state.provider || usedModel.model !== state.model)) {
          setState((prev) => Object.assign({}, prev, { provider: usedModel.provider, model: usedModel.model, error: '' }));
          if (typeof p.onToast === 'function') p.onToast(NW.t('原模型没有响应，已改用 {0}', usedModel.label), 'warn');
        }
        const rows = ((data && data.suggestions) || []).map((row, index) => ({
          id: row.id == null ? 's' + index : row.id,
          start: Number(row.start) || 0,
          end: Number(row.end) || 0,
          original: String(row.original == null ? '' : row.original),
          replacement: String(row.replacement == null ? '' : row.replacement),
          reason: String(row.reason == null ? '' : row.reason),
          type: String(row.type == null ? '' : row.type),
        }));
        sourceRef.current = text;
        setSuggestions(rows);
        const initial = {};
        rows.forEach((row) => {
          initial[row.id] = false;
        });
        setDecided(initial);
        if (rows.length === 0 && typeof p.onToast === 'function') p.onToast('没有发现需要修改的地方', 'ok');
      } catch (err) {
        setState((prev) => Object.assign({}, prev, { error: errText(err, '校对失败') }));
      } finally {
        setRunning(false);
      }
    };

    const acceptAll = () => {
      const next = {};
      (suggestions || []).forEach((row) => {
        next[row.id] = true;
      });
      setDecided(next);
    };
    const rejectAll = () => {
      const next = {};
      (suggestions || []).forEach((row) => {
        next[row.id] = false;
      });
      setDecided(next);
    };

    const acceptedCount = (suggestions || []).filter((row) => decided[row.id]).length;

    const apply = async () => {
      if (acceptedCount === 0) {
        if (typeof p.onToast === 'function') p.onToast('没有勾选任何修改', 'error');
        return;
      }
      const live = textOf(p);
      if (sourceRef.current && live !== sourceRef.current) {
        const message = '正文在校对之后改过，建议的位置已经对不上。请重新校对一次再应用。';
        setState((prev) => Object.assign({}, prev, { error: message }));
        if (typeof p.onToast === 'function') p.onToast(message, 'error');
        return;
      }
      setApplying(true);
      try {
        const text = live;
        const ids = new Set();
        (suggestions || []).forEach((row) => {
          if (decided[row.id]) ids.add(row.id);
        });
        const next = NW.format.applyEdits(text, suggestions || [], ids);
        const api = p.editorApi && p.editorApi.current;
        if (api && typeof api.setContent === 'function') api.setContent(next);
        if (typeof p.onRefreshData === 'function') await p.onRefreshData();
        if (typeof p.onToast === 'function') p.onToast('已应用 ' + acceptedCount + ' 处修改', 'ok');
        if (typeof p.onClose === 'function') p.onClose();
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '应用失败'), 'error');
      } finally {
        setApplying(false);
      }
    };

    const body = [];

    body.push(
      h(
        'div',
        { className: 'nw-inline', style: { gap: '8px', marginBottom: '10px', flexWrap: 'wrap' } },
        NW.ui.select({
          options: modelOptions.length ? modelOptions : [{ value: '', label: state.loading ? '加载中…' : '无可用模型' }],
          value: currentValue,
          ariaLabel: '校对模型',
          onChange: (value) => {
            const parts = String(value).split('\u0000');
            setState((prev) => Object.assign({}, prev, { provider: parts[0] || '', model: parts[1] || '' }));
          },
          style: { flex: '1 1 220px', width: 'auto' },
        }),
        NW.ui.btn({ kind: 'primary', onClick: run, disabled: running || !currentValue, children: running ? '校对中…' : NW.t('AI 校对') }),
      ),
    );

    if (running) body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner('正在检查错别字、词语误用与标点…')));
    if (state.error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, state.error));

    if (suggestions && suggestions.length > 0) {
      body.push(
        h(
          'div',
          { className: 'nw-inline', style: { justifyContent: 'space-between', margin: '4px 0 8px' } },
          h('span', { className: 'nw-dim' }, '共 ' + suggestions.length + ' 条建议 · 已选 ' + acceptedCount + ' 条'),
          h(
            'span',
            { style: { display: 'inline-flex', gap: '6px' } },
            NW.ui.btn({ kind: 'ghost', onClick: acceptAll, children: NW.t('全部接受') }),
            NW.ui.btn({ kind: 'ghost', onClick: rejectAll, children: NW.t('全部拒绝') }),
          ),
        ),
      );
      body.push(
        h(
          'div',
          { className: 'nw-suggest-list', role: 'list' },
          suggestions.map((row) =>
            h(
              'div',
              { key: row.id, className: 'nw-suggest', role: 'listitem', 'data-on': decided[row.id] ? '1' : '0' },
              h('input', {
                type: 'checkbox',
                checked: !!decided[row.id],
                'aria-label': '接受这条修改',
                onChange: (ev) => setDecided((prev) => Object.assign({}, prev, { [row.id]: ev.target.checked })),
              }),
              h(
                'div',
                { className: 'nw-suggest-body' },
                h(
                  'div',
                  { className: 'nw-suggest-diff' },
                  h('del', null, row.original || '∅'),
                  h('span', { className: 'nw-suggest-arrow', 'aria-hidden': 'true' }, ' → '),
                  h('ins', null, row.replacement || '∅'),
                ),
                row.reason ? h('div', { className: 'nw-suggest-reason' }, row.reason) : null,
                row.type ? h('div', { className: 'nw-suggest-type' }, row.type) : null,
              ),
              h(
                'div',
                { className: 'nw-suggest-actions' },
                NW.ui.btn({
                  kind: 'ghost',
                  onClick: () => setDecided((prev) => Object.assign({}, prev, { [row.id]: true })),
                  children: NW.t('接受'),
                }),
                NW.ui.btn({
                  kind: 'ghost',
                  onClick: () => setDecided((prev) => Object.assign({}, prev, { [row.id]: false })),
                  children: NW.t('拒绝'),
                }),
              ),
            ),
          ),
        ),
      );
    } else if (suggestions && suggestions.length === 0 && !running) {
      body.push(NW.ui.empty('没有发现问题，可以放心继续写作。'));
    }

    return modal(
      NW.t('AI 校对'),
      h('div', null, body),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        closeBtn(p),
        NW.ui.btn({ kind: 'primary', onClick: apply, disabled: applying || acceptedCount === 0, children: NW.t('应用') + (acceptedCount ? ' (' + acceptedCount + ')' : '') }),
      ),
      '640px',
      p.onClose,
    );
  };

  // ============================================================= Typeset ====
  NW.dialogs.Typeset = function Typeset(props) {
    const p = props || {};
    const [original] = useState(() => textOf(p));
    const result = useMemo(() => {
      try {
        return NW.format.typeset(original, {});
      } catch (err) {
        return { text: original, edits: [] };
      }
    }, [original]);
    const [busy, setBusy] = useState(false);
    const diff = useMemo(() => {
      try {
        return NW.format.diffPreview(original, result.text);
      } catch (err) {
        return [];
      }
    }, [original, result.text]);

    const apply = async () => {
      // The preview is a snapshot of the chapter taken when the dialog opened.
      // Applying it after the writer typed would silently drop that typing.
      if (textOf(p) !== original) {
        const message = '正文在预览之后改过，请重新打开一次排版预览再应用。';
        if (typeof p.onToast === 'function') p.onToast(message, 'error');
        return;
      }
      setBusy(true);
      try {
        const api = p.editorApi && p.editorApi.current;
        if (api && typeof api.setContent === 'function') api.setContent(result.text);
        if (typeof p.onRefreshData === 'function') await p.onRefreshData();
        if (typeof p.onToast === 'function') p.onToast('排版已应用到当前章节', 'ok');
        if (typeof p.onClose === 'function') p.onClose();
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '应用失败'), 'error');
      } finally {
        setBusy(false);
      }
    };

    const changed = diff.filter((row) => row.type !== 'same').length;

    return modal(
      NW.t('一键排版'),
      h(
        'div',
        null,
        h('p', { className: 'nw-hint-block' }, '预览模式：原文不会被覆盖，确认后才会写入。'),
        h(
          'div',
          { className: 'nw-inline', style: { justifyContent: 'space-between', marginBottom: '8px' } },
          h('span', { className: 'nw-dim' }, '规则命中 ' + (result.edits || []).length + ' 处 · 变更行 ' + changed),
          h('span', { className: 'nw-dim' }, '原文 ' + NW.fmtWords(NW.format.wordCount(original)) + ' 字 → 排版后 ' + NW.fmtWords(NW.format.wordCount(result.text)) + ' 字'),
        ),
        h(
          'div',
          { className: 'nw-diff', role: 'region', 'aria-label': '排版预览' },
          diff.map((row, index) => {
            if (row.type === 'same') return null;
            return h(
              'div',
              { key: 'd' + index, className: 'nw-diff-row', 'data-type': row.type },
              h('span', { className: 'nw-diff-mark', 'aria-hidden': 'true' }, row.type === 'add' ? '+' : '−'),
              h('span', { className: 'nw-diff-text' }, row.text || ' '),
            );
          }),
          changed === 0 ? h('div', { className: 'nw-dim', style: { padding: '10px' } }, '当前章节已经符合排版规范。') : null,
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        closeBtn(p),
        NW.ui.btn({ kind: 'primary', onClick: apply, disabled: busy || changed === 0, children: NW.t('应用') }),
      ),
      '720px',
      p.onClose,
    );
  };

  // ============================================================== Backup ====
  /**
   * 自动保存与恢复 (R9).
   *
   * Cloud backup is gone. What is left needs no server at all: pick a folder, and
   * every edit re-writes the whole library into it as an AES-256-GCM envelope
   * (`.nwe`), overwriting in place. The same panel reads that envelope back and
   * replaces the local database with it, so a fresh install can be brought back
   * from nothing but the encrypted file.
   *
   * Two restore sources, because they answer different questions:
   * - the configured folder (`library.restore` opens it on the host);
   * - a single file the user drags in through the browser picker. The page never
   *   learns a filesystem path, so the bytes travel to the host, which decrypts
   *   them there and answers with the same snapshot envelope.
   */
  NW.dialogs.Backup = function Backup(props) {
    const p = props || {};
    const seed = p.library || {};
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [hint, setHint] = useState('');
    const [dir, setDir] = useState(() => String(seed.dir || ''));
    const [auto, setAuto] = useState(() => seed.mirror === true);
    const [encrypt, setEncrypt] = useState(() => seed.encrypt !== false);
    const [lastAt, setLastAt] = useState(() => Number(seed.lastMirrorAt) || 0);
    const [files, setFiles] = useState([]);

    const refreshFiles = useCallback(async () => {
      try {
        const data = await NW.io.library.list();
        if (data && Array.isArray(data.files)) setFiles(data.files);
      } catch (err) {
        /* the listing is cosmetic; a host half without library.* must not break */
      }
    }, []);

    useEffect(() => {
      refreshFiles();
    }, [refreshFiles]);

    const run = async (label, fn) => {
      setBusy(label);
      setError('');
      setHint('');
      try {
        return await fn();
      } catch (err) {
        setError(errText(err, '操作失败'));
        return null;
      } finally {
        setBusy('');
      }
    };

    /** Persists the folder / auto-save / encrypt trio, then mirrors once. */
    const persist = async (patch) => {
      const next = await p.onLibrary(patch);
      if (!next) return null;
      setDir(String(next.dir || ''));
      setAuto(next.mirror === true);
      setEncrypt(next.encrypt === true);
      setLastAt(Number(next.lastMirrorAt) || 0);
      refreshFiles();
      return next;
    };

    /** Replaces the local database with a snapshot the host handed back. */
    const restoreSnapshot = async (res) => {
      const snapshot = res && res.snapshot;
      if (!snapshot) throw new Error('备份文件里没有可恢复的内容');
      const novels = Array.isArray(snapshot.novels) ? snapshot.novels.length : 0;
      const chapters = Array.isArray(snapshot.chapters) ? snapshot.chapters.length : 0;
      const notes = Array.isArray(snapshot.notes) ? snapshot.notes.length : 0;
      // R34: statuses live on the host, so the merge result — not the snapshot —
      // is what actually happened. Report it instead of implying a full restore.
      const merged = res && res.submissions && Number(res.submissions.imported) > 0
        ? Number(res.submissions.imported)
        : 0;
      await NW.db.replaceAll(snapshot);
      if (typeof p.onRefreshData === 'function') await p.onRefreshData();
      const bits = [
        '已恢复 ' + novels + ' 部小说',
        chapters + ' 章',
        notes > 0 ? notes + ' 条灵感' : '',
        merged > 0 ? merged + ' 条投稿状态' : '',
      ].filter(Boolean);
      if (!snapshot.novels || !snapshot.novels.length) {
        setHint('备份文件是空的，本地数据已被清空。');
      } else {
        setHint(bits.join('、') + '。');
      }
      NW.ui.toast('已恢复 ' + novels + ' 部小说', 'ok');
      return res;
    };

    const confirmRestore = () =>
      NW.ui.confirm('恢复会用备份内容覆盖当前全部小说与章节，且无法撤销。确定继续？', {
        title: '确认恢复',
        danger: true,
        okText: '覆盖恢复',
      });

    // ---- actions -------------------------------------------------------
    const chooseDir = () =>
      run('打开文件夹选择器…', async () => {
        const picked = await NW.io.library.pick();
        const folder = String((picked && picked.dir) || '');
        if (!folder) return null;
        await persist({ dir: folder, mirror: true, encrypt: encrypt });
        setHint('已选择保存位置：之后每次修改都会自动覆盖这个文件夹里的文件。');
        return picked;
      });

    const saveNow = () =>
      run('正在保存…', async () => {
        if (!dir) throw new Error('请先选择保存文件夹');
        const data = await p.onLibraryMirror();
        if (!data) throw new Error('保存失败，请检查文件夹是否可写');
        setLastAt(Number(data.lastMirrorAt) || Date.now());
        setHint('已保存 ' + (Number(data.count) || 0) + ' 部小说到该文件夹。');
        refreshFiles();
        return data;
      });

    const restoreFromFolder = () =>
      run('正在读取文件夹…', async () => {
        if (!dir) throw new Error('请先选择保存文件夹');
        const res = await NW.io.library.restore({ dir: dir });
        if (!(await confirmRestore())) return null;
        return await restoreSnapshot(res);
      });

    const restoreFromFile = () =>
      run('正在读取文件…', async () => {
        const picked = await NW.io.pickFiles('.json,.nwe');
        const file = picked && picked[0];
        if (!file) return null;
        const text =
          typeof file.text === 'function' ? await file.text() : await readAsTextFallback(file);
        if (!String(text || '').trim()) throw new Error('选中的文件是空的');
        const res = await NW.io.library.restore({ text: String(text), name: String(file.name || '') });
        if (!(await confirmRestore())) return null;
        return await restoreSnapshot(res);
      });

    // ---- render --------------------------------------------------------
    const body = [];

    body.push(
      NW.ui.field({
        label: '保存文件夹',
        hint: '小说会以 Word 文档写进这个目录（加密时是 .docx.nwe），每次修改自动覆盖，不需要手动另存。',
        children: h(
          'div',
          { className: 'nw-inline', style: { gap: '6px' } },
          NW.ui.input({
            value: dir,
            placeholder: '例如 D:\\我的小说备份',
            onChange: (v) => setDir(v),
            ariaLabel: '保存文件夹',
          }),
          NW.ui.btn({
            onClick: chooseDir,
            disabled: !!busy,
            title: '用系统对话框选择文件夹',
            children: NW.t('选择…'),
          }),
          NW.ui.btn({
            onClick: () =>
              run('正在保存设置…', async () => {
                if (!String(dir || '').trim()) throw new Error('请填写或选择一个文件夹');
                await persist({ dir: String(dir).trim(), mirror: auto, encrypt: encrypt });
              }),
            disabled: !!busy,
            children: NW.t('保存'),
          }),
        ),
      }),
    );

    body.push(
      h(
        'div',
        { className: 'nw-row' },
        h('span', null, '修改后自动保存（覆盖）'),
        NW.ui.toggle({
          checked: auto,
          onChange: (v) => {
            setAuto(v);
            run('正在保存设置…', async () => {
              if (v && !String(dir || '').trim()) throw new Error('请先选择保存文件夹');
              await persist({ dir: String(dir).trim(), mirror: v, encrypt: encrypt });
            });
          },
          label: '修改后自动保存',
        }),
      ),
    );

    body.push(
      h(
        'div',
        { className: 'nw-row' },
        h('span', null, '加密（AES-256-GCM）'),
        NW.ui.toggle({
          checked: encrypt,
          onChange: (v) => {
            setEncrypt(v);
            run('正在保存设置…', async () => {
              if (!String(dir || '').trim()) return;
              await persist({ dir: String(dir).trim(), mirror: auto, encrypt: v });
            });
          },
          label: '加密保存',
        }),
      ),
    );

    body.push(
      h(
        'p',
        { className: 'nw-hint-block' },
        encrypt
          ? '加密后文件扩展名是 .docx.nwe，用其它编辑器打不开；密钥只保存在本机，换台电脑要先恢复密码。'
          : '当前是明文存储，文件夹里的 .docx 可以直接用 Word 打开。',
      ),
    );

    body.push(
      h(
        'div',
        { className: 'nw-row' },
        h('span', null, '立即保存一份'),
        h(
          'span',
          { className: 'nw-inline', style: { gap: '6px' } },
          NW.ui.btn({ onClick: saveNow, disabled: !!busy || !dir, children: '立即保存' }),
        ),
      ),
    );

    body.push(
      h(
        'div',
        { className: 'nw-row' },
        h('span', null, '从上面这个文件夹恢复'),
        NW.ui.btn({ onClick: restoreFromFolder, disabled: !!busy || !dir, children: '恢复…' }),
      ),
    );

    body.push(
      h(
        'div',
        { className: 'nw-row' },
        h('span', null, '从备份文件恢复（.nwe / .json）'),
        NW.ui.btn({ onClick: restoreFromFile, disabled: !!busy, children: '选择文件…' }),
      ),
    );

    const statusLine = [];
    if (!dir) statusLine.push('还没有选择保存文件夹，当前只写在浏览器本地。');
    else {
      statusLine.push(
        auto ? '自动保存已开启' : '自动保存已关闭（只能手动保存）',
        encrypt ? '加密存储 .docx.nwe' : '明文存储 .docx',
      );
      if (lastAt) statusLine.push('上次保存 ' + NW.fmtDate(lastAt));
    }
    body.push(h('p', { className: 'nw-hint-block' }, statusLine.join(' · ')));

    if (files && files.length) {
      body.push(
        h(
          'div',
          { className: 'nw-hint-block' },
          files
            .slice(0, 8)
            .map((row) =>
              h(
                'div',
                { key: String(row.name) },
                String(row.name) + ' · ' + fmtSize(row.bytes) + (row.encrypted ? ' · 加密' : ''),
              ),
            ),
        ),
      );
    }

    if (busy) body.push(h('div', { className: 'nw-inline', style: { marginTop: '10px' } }, NW.ui.spinner(busy)));
    if (error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, error));
    if (hint) body.push(h('p', { className: 'nw-hint-block' }, hint));

    return modal(
      '自动保存与恢复',
      h('div', null, body),
      h('div', { style: { display: 'flex', gap: '8px' } }, closeBtn(p)),
      '600px',
      p.onClose,
    );
  };

  /** `file.text()` is universal in the browsers we support; this is the fallback. */
  function readAsTextFallback(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsText(file, 'utf-8');
      } catch (err) {
        reject(err instanceof Error ? err : new Error('读取文件失败'));
      }
    });
  }

  // ============================================================ Settings ====
  /**
   * Six sections, in the order the contract fixes (docs/CONTRACT-R3.md §9):
   * appearance, writing, export & files, privacy & lock, submission, shortcuts.
   * Everything that used to be a toolbar button (backup, version history,
   * theme, typewriter) now has an entry here as well, so the toolbar can stay
   * as small as the contract asks.
   */
  NW.dialogs.Settings = function Settings(props) {
    const p = props || {};
    const settings = p.settings || {};
    const lanSync = p.syncState || {};
    const [draft, setDraft] = useState(() => Object.assign({}, settings));
    const set = (key, value) => {
      const next = Object.assign({}, draft, { [key]: value });
      setDraft(next);
      if (typeof p.onSettings === 'function') p.onSettings({ [key]: value });
    };
    const [models, setModels] = useState(null);
    const [pwState, setPwState] = useState({ has: false, value: '', oldValue: '', nextValue: '', error: '' });
    const [libState, setLibState] = useState({
      dir: (p.library && p.library.dir) || '',
      mirror: !!(p.library && p.library.mirror),
      encrypt: !!(p.library && p.library.encrypt),
      busy: '',
      error: '',
      files: null,
    });
    const [smtp, setSmtp] = useState({
      host: '',
      port: '465',
      secure: true,
      user: '',
      password: '',
      configured: false,
      hasPassword: false,
      busy: '',
      error: '',
      hint: '',
    });
    const [journalCount, setJournalCount] = useState(null);
    const [busy, setBusy] = useState('');
    /** Provider presets for the SMTP form (host / port / secure / note). */
    const [presets, setPresets] = useState([]);
    /**
     * IMAP half of the same mailbox: the author sends with SMTP and reads the
     * journal's reply with IMAP, so 收件箱 lives right under 发信设置 rather
     * than in a separate account manager.
     */
    const [imap, setImap] = useState({
      enabled: true,
      host: '',
      port: '993',
      secure: true,
      user: '',
      password: '',
      useSmtp: true,
      configured: false,
      hasPassword: false,
      busy: '',
      error: '',
      hint: '',
    });
    const [imapPresets, setImapPresets] = useState([]);

    // The host passes these callbacks in, but a dialog can be rendered in a
    // harness build that omits one of them; degrade instead of throwing.
    const applySettings = async (patch) => {
      if (typeof p.onSettings === 'function') return p.onSettings(patch);
      setDraft((prev) => Object.assign({}, prev, patch || {}));
      return null;
    };
    const notify = (message, kind) => {
      if (typeof p.onToast === 'function') p.onToast(String(message || ''), kind || 'info');
    };

    useEffect(() => {
      let alive = true;
      NW.ai
        .models()
        .then((data) => {
          if (alive) setModels(data);
        })
        .catch(() => {
          if (alive) setModels(null);
        });
      NW.crypto
        .hasPassword()
        .then((has) => {
          if (alive) setPwState((prev) => Object.assign({}, prev, { has: !!has }));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    // The host half owns the SMTP secrets, so the panel reads them back once
    // instead of trusting a prop that may predate another window's edit.
    useEffect(() => {
      let alive = true;
      if (!(NW.io && NW.io.submit && NW.io.submit.smtpStatus)) return undefined;
      NW.io.submit
        .smtpStatus()
        .then((data) => {
          if (!alive || !data) return;
          setSmtp((prev) =>
            Object.assign({}, prev, {
              host: String(data.host || prev.host || ''),
              port: String(data.port || prev.port || '465'),
              secure: data.secure !== false,
              user: String(data.user || prev.user || ''),
              configured: data.configured === true,
              hasPassword: data.hasPassword === true,
            }),
          );
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    // The host half keeps the library folder in settings.json; a stale value
    // passed through props would win over a folder chosen in another tab, so
    // pull it once when the panel opens.
    useEffect(() => {
      let alive = true;
      if (!NW.io.library) return undefined;
      NW.io.library
        .get()
        .then((data) => {
          if (!alive || !data) return;
          setLibState((prev) =>
            Object.assign({}, prev, {
              dir: String(data.dir || ''),
              mirror: data.mirror === true,
              encrypt: data.encrypt === true,
            }),
          );
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      let alive = true;
      if (!(NW.io && NW.io.journals && NW.io.journals.list)) return undefined;
      NW.io.journals
        .list()
        .then((data) => {
          if (!alive) return;
          const rows = data && Array.isArray(data.journals) ? data.journals : [];
          setJournalCount(rows.length);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    // Provider presets come from the host half (lib/smtp.js PRESETS) so the host
    // names and the client buttons can never disagree.
    useEffect(() => {
      let alive = true;
      if (!(NW.io && NW.io.submit && NW.io.submit.smtpPresets)) return undefined;
      NW.io.submit
        .smtpPresets()
        .then((data) => {
          if (!alive || !data) return;
          setPresets(Array.isArray(data.presets) ? data.presets : []);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    // IMAP settings + presets. Both are host reads: a mailbox configured in
    // another window must win over this panel's initial state.
    useEffect(() => {
      let alive = true;
      if (!(NW.io && NW.io.inbox)) return undefined;
      NW.io.inbox
        .status()
        .then((data) => {
          if (!alive || !data) return;
          setImap((prev) =>
            Object.assign({}, prev, {
              enabled: data.enabled !== false,
              host: String(data.host || prev.host || ''),
              port: String(data.port || prev.port || '993'),
              secure: data.secure !== false,
              user: String(data.user || prev.user || ''),
              useSmtp: data.useSmtp !== false,
              configured: data.configured === true,
              hasPassword: data.hasPassword === true,
            }),
          );
          setImapPresets(Array.isArray(data.presets) ? data.presets : []);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []);

    const modelOptions = useMemo(() => {
      const list = (models && models.models) || [];
      const current = (models && models.current) || {};
      const options = list.map((row) => ({
        value: row.provider + '\u0000' + row.id,
        label: (row.name || row.id) + ' · ' + row.provider,
      }));
      // R29: the harness default is a valid target even when discovery returns
      // nothing for that provider (some expose no model list at all). Without
      // this row the picker would offer only "跟随默认模型" and look broken.
      if (current.provider && current.model) {
        const value = current.provider + '\u0000' + current.model;
        if (!options.some((opt) => opt.value === value)) {
          options.unshift({ value: value, label: current.model + ' · ' + current.provider + '（当前默认）' });
        }
      }
      return [{ value: '', label: '跟随默认模型' }].concat(options);
    }, [models]);

    /** R29: kept for the proofread dialog's own fallback, not for Settings. */
    const proofreadValue = draft.proofreadProvider && draft.proofreadModel ? draft.proofreadProvider + '\u0000' + draft.proofreadModel : '';

    /**
     * R29: one picker per AI job. A job's model is a provider+model pair, so the
     * select has to write two settings at once — `set()` only owns one key.
     * An empty value means "follow the harness default", which is the shipped
     * state; that is why every pair starts as `null` rather than a guessed id.
     */
    const modelPicker = (label, provKey, modKey, hint) =>
      NW.ui.field({
        label: label,
        hint: hint,
        children: NW.ui.select({
          value: draft[provKey] && draft[modKey] ? draft[provKey] + '\u0000' + draft[modKey] : '',
          onChange: (value) => {
            const parts = String(value || '').split('\u0000');
            const patch = {};
            patch[provKey] = parts[0] || null;
            patch[modKey] = parts[1] || null;
            setDraft((prev) => Object.assign({}, prev, patch));
            if (typeof p.onSettings === 'function') p.onSettings(patch);
          },
          options: modelOptions,
          ariaLabel: label,
        }),
      });

    /**
     * Set or change the password.
     *
     * Changing must verify the current password first: the key is derived from
     * it, so accepting a new one without proof would let anyone holding an
     * unlocked session silently lock the real owner out of their own library.
     * `NW.crypto.changePassword` verifies against the stored verifier and only
     * then replaces it — the local helper here owns the DB re-sealing around it.
     */
    const setPassword = async () => {
      const changing = !!pwState.has;
      const nextValue = changing ? pwState.nextValue : pwState.value;
      const oldValue = pwState.oldValue;
      if (!nextValue || nextValue.length < 4) {
        setPwState((prev) => Object.assign({}, prev, { error: '密码至少 4 位' }));
        return;
      }
      if (changing && nextValue === oldValue) {
        setPwState((prev) => Object.assign({}, prev, { error: '新密码不能与当前密码相同' }));
        return;
      }
      if (changing && !oldValue) {
        setPwState((prev) => Object.assign({}, prev, { error: '请输入当前密码' }));
        return;
      }
      setBusy('设置密码…');
      let restored = 0;
      try {
        if (changing) {
          // Verify the old password without touching the key, then open every
          // sealed row while the current key is still usable. Both steps have
          // to happen before setPassword() swaps the key, otherwise the library
          // becomes ciphertext that nothing can read.
          const ok = await NW.crypto.verifyPassword(oldValue);
          if (!ok) {
            setPwState((prev) => Object.assign({}, prev, { error: NW.t('密码错误') }));
            return;
          }
          restored = await NW.db.decryptAll();
          const changed = await NW.crypto.changePassword(oldValue, nextValue);
          if (!changed) {
            setPwState((prev) => Object.assign({}, prev, { error: NW.t('密码错误') }));
            return;
          }
        } else {
          await NW.crypto.setPassword(nextValue);
        }
        await applySettings({ lockEnabled: true, encryption: true });
        const sealed = await NW.db.encryptAll();
        setPwState({ has: true, value: '', oldValue: '', nextValue: '', error: '' });
        notify(changing ? '密码已更新，正文已重新加密' : '密码已设置，正文已加密', 'ok');
        if (changing && sealed !== restored) {
          notify('已加密 ' + sealed + ' 段正文', 'info');
        }
      } catch (err) {
        setPwState((prev) => Object.assign({}, prev, { error: errText(err, '设置密码失败') }));
      } finally {
        setBusy('');
      }
    };

    const clearPassword = async () => {
      if (!pwState.value) {
        setPwState((prev) => Object.assign({}, prev, { error: '请输入当前密码' }));
        return;
      }
      setBusy('清除密码…');
      try {
        // Verify against the stored verifier without dropping the key yet: the
        // ciphertext must be opened up BEFORE the password (and key) go away,
        // otherwise the whole library is lost.
        const probe = await NW.crypto.unlock(pwState.value);
        if (!probe) {
          setPwState((prev) => Object.assign({}, prev, { error: NW.t('密码错误') }));
          return;
        }
        const restored = await NW.db.decryptAll();
        const ok = await NW.crypto.clearPassword(pwState.value);
        if (!ok) {
          setPwState((prev) => Object.assign({}, prev, { error: NW.t('密码错误') }));
          return;
        }
        await applySettings({ lockEnabled: false, encryption: false });
        setPwState({ has: false, value: '', oldValue: '', nextValue: '', error: '' });
        if (typeof p.onRefreshData === 'function') await p.onRefreshData();
        notify('密码已清除' + (restored > 0 ? '，' + restored + ' 段正文已还原为明文' : ''), 'ok');
      } catch (err) {
        setPwState((prev) => Object.assign({}, prev, { error: errText(err, '清除密码失败') }));
      } finally {
        setBusy('');
      }
    };

    // ------------------------------------------------------------ SMTP ------
    const saveSmtp = async () => {
      setSmtp((prev) => Object.assign({}, prev, { busy: '正在保存邮箱设置…', error: '', hint: '' }));
      try {
        if (!(NW.io && NW.io.submit && NW.io.submit.smtpConfigure)) throw new Error('当前版本不支持邮箱设置');
        const data = await NW.io.submit.smtpConfigure({
          host: smtp.host,
          port: Number(smtp.port) || 465,
          secure: smtp.secure,
          user: smtp.user,
          password: smtp.password,
        });
        setSmtp((prev) =>
          Object.assign({}, prev, {
            configured: !!(data && (data.configured || data.host)) || !!String(prev.host || '').trim(),
            hasPassword: data ? data.hasPassword !== false : prev.hasPassword,
            password: '',
            error: '',
            hint: '邮箱设置已保存。可以点「测试连接」确认服务器可达。',
          }),
        );
        notify('投稿邮箱已保存', 'ok');
      } catch (err) {
        setSmtp((prev) =>
          Object.assign({}, prev, {
            error: errText(err, '保存邮箱设置失败'),
            hint: '常见原因：主机名写错（如 smtp.qq.com）、端口与 TLS 不匹配（465 用 SSL，587 用 STARTTLS）、或用了登录密码而不是授权码。',
          }),
        );
      } finally {
        setSmtp((prev) => Object.assign({}, prev, { busy: '' }));
      }
    };

    // R7: the host now reports *why* each port failed instead of one blanket
    // message; translate the codes so the probe reads like a diagnosis.
    const ATTEMPT_REASON = {
      'smtp-auth-failed': '端口通，账号或授权码被拒',
      'smtp-auth-unsupported': '端口通，不支持该登录方式',
      'smtp-tls-failed': 'TLS 握手失败',
      'smtp-cert-failed': '证书校验失败',
      'smtp-port-closed': '端口未开放',
      'smtp-dns-failed': '域名解析失败',
      'smtp-unreachable': '网络不可达',
      'smtp-timeout': '连接超时',
      'smtp-greeting-failed': '服务器未正确响应',
      'smtp-connection-closed': '连接被关闭',
      'smtp-rejected': '被服务器拒绝',
      'smtp-connect-failed': '连接失败',
    };
    const reasonOf = (code) => ATTEMPT_REASON[String(code || '')] || '';

    /** Render the host's port-matrix probe results as one readable line. */
    const attemptsLine = (attempts) => {
      if (!Array.isArray(attempts) || attempts.length === 0) return '';
      return (
        '已探测 ' +
        attempts
          .map((row) => {
            const reason = row.ok ? '成功' : reasonOf(row.code);
            return String(row.variant || '') + (row.ok ? '✓' : '✗') + (reason ? '（' + reason + '）' : '');
          })
          .join(' / ')
      );
    };

    /**
     * Turn the probe matrix into the one sentence that actually tells the user
     * where the problem is, so they do not have to read the matrix themselves.
     */
    const diagnoseAdvice = (attempts) => {
      const rows = Array.isArray(attempts) ? attempts : [];
      if (rows.length === 0) return '';
      const codes = rows.map((row) => String(row.code || ''));
      if (codes.some((code) => code === 'smtp-auth-failed' || code === 'smtp-auth-unsupported')) {
        return '结论：端口和加密方式都能连通，问题在账号——请确认填的是邮箱「授权码/专用密码」而不是登录密码，并且已在邮箱网页端开启 SMTP 服务。';
      }
      if (codes.every((code) => code === 'smtp-dns-failed')) {
        return '结论：这台电脑解析不到该邮件服务器地址，请核对 SMTP 服务器名是否写错，并检查是否开了代理/加速器或改过 hosts。';
      }
      if (codes.some((code) => code === 'smtp-cert-failed')) {
        return '结论：网络里有软件在做「中间人」替换证书（常见于公司网络、抓包工具、部分杀毒软件）。插件已自动跳过校验重试过，仍失败请关掉该软件或换手机热点。';
      }
      if (codes.every((code) => ['smtp-port-closed', 'smtp-unreachable', 'smtp-timeout', 'smtp-connect-failed'].includes(code))) {
        return '结论：465 / 587 / 25 三个端口都进不去，是网络层面在拦发信端口（公司或校园网最常见）。请换手机热点再点一次「测试连接」，能通就是原网络的问题。';
      }
      return '';
    };

    const testSmtp = async () => {
      setSmtp((prev) => Object.assign({}, prev, { busy: '正在连接邮件服务器…', error: '', hint: '' }));
      try {
        if (!(NW.io && NW.io.submit && NW.io.submit.smtpTest)) throw new Error('当前版本不支持连接测试');
        const data = await NW.io.submit.smtpTest();
        const ok = !data || data.ok !== false;
        const probe = attemptsLine(data && data.attempts);
        if (ok) {
          setSmtp((prev) =>
            Object.assign({}, prev, {
              error: '',
              hint:
                '连接成功：' +
                String((data && data.detail) || '服务器已响应') +
                (probe ? '。' + probe : ''),
            }),
          );
        } else {
          const advice = diagnoseAdvice(data && data.attempts);
          setSmtp((prev) =>
            Object.assign({}, prev, {
              error: String((data && data.message) || '连接失败'),
              hint: [smtpHintFor(String((data && data.code) || ''), String((data && data.message) || '')), advice, probe]
                .filter(Boolean)
                .join(' '),
            }),
          );
        }
      } catch (err) {
        const message = errText(err, '连接失败');
        setSmtp((prev) => Object.assign({}, prev, { error: message, hint: smtpHintFor('', message) }));
      } finally {
        setSmtp((prev) => Object.assign({}, prev, { busy: '' }));
      }
    };

    const openJournals = () => {
      openSibling(p, 'submit', { step: 1 });
    };

    // ---- 收件箱（IMAP）------------------------------------------------------
    // 编辑部回信用的是作者发信的那个邮箱，所以这里只需要主机名 + 授权码；把
    // SMTP 的账号密码借过来（useSmtp）是默认，绝大多数作者只有一个邮箱。
    const IMAP_REASON = {
      'imap-auth-failed': '服务器连上了，但账号或授权码被拒',
      'imap-dns-failed': '域名解析失败，主机名可能写错',
      'imap-port-closed': '端口未开放（993 是 SSL，143 是 STARTTLS）',
      'imap-unreachable': '网络不可达，可能有代理或防火墙',
      'imap-timeout': '连接超时',
      'imap-cert-failed': '证书校验失败，可能有中间人代理',
      'imap-greeting-failed': '服务器没有按 IMAP 协议问候',
      'imap-tls-failed': 'TLS 握手失败',
      'imap-connect-failed': '连接失败',
      'imap-not-configured': '还没有填 IMAP 服务器',
    };
    const imapReason = (code, fallback) => IMAP_REASON[String(code || '')] || String(fallback || '');

    const saveImap = async () => {
      setImap((prev) => Object.assign({}, prev, { busy: '正在保存收件设置…', error: '', hint: '' }));
      try {
        if (!(NW.io && NW.io.inbox && NW.io.inbox.configure)) throw new Error('当前版本不支持收件设置');
        const data = await NW.io.inbox.configure({
          enabled: imap.enabled,
          host: imap.host,
          port: Number(imap.port) || 993,
          secure: imap.secure,
          user: imap.user,
          password: imap.password,
          useSmtp: imap.useSmtp,
        });
        setImap((prev) =>
          Object.assign({}, prev, {
            configured: !!(data && data.configured),
            hasPassword: data ? data.hasPassword !== false : prev.hasPassword,
            password: '',
            error: '',
            hint: data && data.configured ? '收件设置已保存。可以点「测试连接」确认能读到收件箱。' : '',
          }),
        );
        notify('收件设置已保存', 'ok');
      } catch (err) {
        setImap((prev) =>
          Object.assign({}, prev, {
            error: errText(err, '保存收件设置失败'),
            hint: 'IMAP 与 SMTP 是同一套账号：QQ 邮箱是 imap.qq.com，网易是 imap.163.com，Gmail 是 imap.gmail.com。密码同样要填授权码。',
          }),
        );
      } finally {
        setImap((prev) => Object.assign({}, prev, { busy: '' }));
      }
    };

    const testImap = async () => {
      setImap((prev) => Object.assign({}, prev, { busy: '正在读取收件箱…', error: '', hint: '' }));
      try {
        if (!(NW.io && NW.io.inbox && NW.io.inbox.test)) throw new Error('当前版本不支持收件测试');
        const data = await NW.io.inbox.test();
        if (data && data.ok !== false) {
          const unseen = Number(data && data.unseen) || 0;
          setImap((prev) =>
            Object.assign({}, prev, {
              error: '',
              hint:
                '连接成功：收件箱共 ' +
                (Number(data && data.messages) || 0) +
                ' 封，未读 ' +
                unseen +
                ' 封。' +
                (data && data.certBypassed ? '（证书校验被跳过一次）' : ''),
            }),
          );
        } else {
          setImap((prev) =>
            Object.assign({}, prev, {
              error: String((data && data.message) || '收件箱连接失败'),
              hint: [imapReason(data && data.code, ''), String((data && data.hint) || '')].filter(Boolean).join(' '),
            }),
          );
        }
      } catch (err) {
        const message = errText(err, '收件箱连接失败');
        setImap((prev) => Object.assign({}, prev, { error: message, hint: imapReason('', '') }));
      } finally {
        setImap((prev) => Object.assign({}, prev, { busy: '' }));
      }
    };

    // "去配置邮箱" opens Settings with a section hint; land on that section
    // instead of dumping the user at 外观 and letting them hunt for 投稿.
    const submitSectionRef = useRef(null);
    useEffect(() => {
      const want = p.dialog && p.dialog.section;
      if (want !== 'submit') return;
      const node = submitSectionRef.current;
      if (!node || typeof node.scrollIntoView !== 'function') return;
      try {
        node.scrollIntoView({ block: 'start' });
      } catch (err) {
        /* older harness without scrollIntoView options */
      }
    }, []);

    // Settings is a two-column dialog in R5: a section rail on the left, one
    // section's form on the right. Before that it was one very long scroll list
    // (the user's complaint: 「设置页面太多选项，要左右两部分」). All six bodies
    // still render; `data-on` decides which one is visible, so switching a tab
    // never re-runs a section's async loaders.
    const [tab, setTab] = useState(() => {
      const want = String((p.dialog && p.dialog.section) || '');
      return SETTINGS_TABS.some((item) => item.id === want) ? want : 'appearance';
    });
    let sectionIndex = 0;
    const section = (title, children, extra) => {
      // R38 fix: this signature takes ONE body element. A second body used to
      // land in `extra`, get spread onto the <section>, and vanish — which is
      // how the pairing panel silently disappeared from the DOM. Fail loudly
      // instead: a React element always carries $$typeof.
      if (extra && typeof extra === 'object' && extra.$$typeof) {
        throw new Error('[novel-writer] section() takes one body; wrap multiple children in an array');
      }
      const meta = SETTINGS_TABS[sectionIndex] || { id: 'other' };
      sectionIndex += 1;
      return h(
        'section',
        Object.assign({}, extra || {}, {
          className: 'nw-settings-section',
          'data-tab': meta.id,
          'data-on': tab === meta.id ? '1' : '0',
        }),
        h('h3', null, title),
        children,
      );
    };

    // R16 ⑥: a 4th `hint` argument now renders as a real note under the row —
    // before it only reached the tooltip, and the 标点 switch needs to explain
    // what it changes.
    const rowToggle = (label, checked, onChange, hint) =>
      h(
        'div',
        { className: 'nw-row' },
        h(
          'span',
          { className: 'nw-rowlabel' },
          h('span', null, label),
          hint ? h('span', { className: 'nw-dim nw-rowhint' }, hint) : null,
        ),
        NW.ui.toggle({ checked: !!checked, onChange: onChange, label: label, title: hint || label }),
      );

    return modal(
      NW.t('设置'),
      h(
        'div',
        { className: 'nw-settings' },
        h(
          'nav',
          { className: 'nw-settings-nav', role: 'tablist', 'aria-label': NW.t('设置') },
          SETTINGS_TABS.map((item) =>
            h(
              'button',
              {
                key: item.id,
                type: 'button',
                role: 'tab',
                className: 'nw-settings-navbtn',
                'data-active': tab === item.id ? '1' : '0',
                'aria-selected': tab === item.id ? 'true' : 'false',
                onClick: () => setTab(item.id),
              },
              NW.icon(item.icon, { size: 16 }),
              h('span', null, item.label),
            ),
          ),
        ),
        h(
        'div',
        { className: 'nw-settings-pane' },
        // ---------------------------------------------------------- 1 外观 ----
        section(
          '外观',
          h(
            'div',
            null,
            NW.ui.field({
              label: NW.t('主题'),
              children: h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' } },
                THEME_OPTIONS.map((entry) => themeChoice(entry, (draft.theme || 'claude') === entry.value, (value) => set('theme', value))),
              ),
            }),
            NW.ui.field({
              label: NW.t('字体'),
              children: NW.ui.select({
                value: draft.fontFamily || '',
                onChange: (value) => set('fontFamily', value),
                options: [
                  { value: '"Noto Serif SC","Source Han Serif SC","Songti SC",serif', label: '宋体 / 衬线' },
                  { value: '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif', label: '黑体 / 无衬线' },
                  { value: '"LXGW WenKai","Kaiti SC","KaiTi",serif', label: '楷体 / 文艺' },
                  { value: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', label: '等宽' },
                ],
              }),
            }),
            h(
              'div',
              { className: 'nw-grid2' },
              NW.ui.field({
                label: NW.t('字号') + ' · ' + (draft.fontSize || 20) + 'px',
                children: rangeInput({ value: draft.fontSize || 20, min: 14, max: 28, step: 1, onChange: (v) => set('fontSize', v) }),
              }),
              NW.ui.field({
                label: NW.t('行距') + ' · ' + (draft.lineHeight || 2.0),
                children: rangeInput({ value: draft.lineHeight || 2.0, min: 1.4, max: 2.8, step: 0.1, onChange: (v) => set('lineHeight', v) }),
              }),
            ),
            NW.ui.field({
              label: NW.t('页宽') + ' · ' + (draft.pageWidth || 760) + 'px',
              children: rangeInput({ value: draft.pageWidth || 760, min: 560, max: 1000, step: 20, onChange: (v) => set('pageWidth', v) }),
            }),
            // R11 ④: the caret is painted by the editor itself (.nw-cursor), so its
            // thickness, colour and blink are plain settings instead of a stylesheet
            // detail the user would have to hack.
            h(
              'div',
              { className: 'nw-grid2' },
              NW.ui.field({
                label: NW.t('光标粗细') + ' · ' + (draft.caretWidth || 3) + 'px',
                children: rangeInput({ value: draft.caretWidth || 3, min: 1, max: 8, step: 1, onChange: (v) => set('caretWidth', v) }),
              }),
              NW.ui.field({
                label: NW.t('光标颜色'),
                hint: NW.t('留空表示跟随主题。'),
                children: h(
                  'div',
                  { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                  h('input', {
                    type: 'color',
                    value: draft.caretColor || '#141413',
                    'aria-label': NW.t('光标颜色'),
                    onChange: (ev) => set('caretColor', String(ev.target.value || '')),
                    style: {
                      width: '38px',
                      height: '32px',
                      padding: '2px',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: '8px',
                      background: 'var(--dsw-alias-bg-base)',
                      cursor: 'pointer',
                      flex: '0 0 auto',
                    },
                  }),
                  NW.ui.input({
                    value: draft.caretColor || '',
                    placeholder: NW.t('跟随主题'),
                    ariaLabel: NW.t('光标颜色'),
                    onChange: (v) => set('caretColor', String(v || '').trim()),
                    style: { flex: '1 1 auto' },
                  }),
                ),
              }),
            ),
            rowToggle('光标闪烁', draft.caretBlink !== false, (v) => set('caretBlink', v)),
            rowToggle('打字机模式', draft.typewriter, (v) => set('typewriter', v)),
            rowToggle('沉浸模式（隐藏所有面板，Esc 退出）', draft.immersive, (v) => set('immersive', v)),
          ),
        ),
        // ---------------------------------------------------------- 2 写作 ----
        section(
          '写作',
          h(
            'div',
            null,
            rowToggle(
              '统计字数包含标点符号',
              draft.countPunctuation !== false,
              (v) => set('countPunctuation', v),
              '关闭后，状态栏、书籍总字数和投稿预览里的字数都会扣掉标点。默认包含，与常见中文写作软件一致。',
            ),
            NW.ui.field({
              label: '自动保存间隔（毫秒）',
              children: NW.ui.input({
                type: 'number',
                value: draft.autoSaveMs || 1200,
                onChange: (v) => set('autoSaveMs', Math.max(300, Number(v) || 1200)),
                style: { maxWidth: '140px' },
              }),
            }),
            NW.ui.field({
              label: '文末追加内容',
              hint: '导出时追加在正文最后，例如署名、联系方式或「未完待续」。',
              children: NW.ui.textarea({
                rows: 3,
                value: String(draft.exportSignature || ''),
                placeholder: '例如：作者：某某 · 邮箱 someone@example.com',
                onChange: (v) => set('exportSignature', v),
                ariaLabel: '文末追加内容',
              }),
            }),
            rowToggle('导出时追加', draft.exportSignatureOn, (v) => set('exportSignatureOn', v)),
            rowToggle('导出包含书名与作者', draft.exportIncludeMeta, (v) => set('exportIncludeMeta', v)),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '封面图片'),
              NW.ui.btn({ onClick: () => openSibling(p, 'export', {}), children: '在导出面板中选择…' }),
            ),
            // R29: three AI jobs, three models. Each defaults to the harness
            // model; the writer picks a cheap one for proofreading and a strong
            // one for the editorial advice if they want. 「跟随默认模型」 is the
            // shipped state, not a placeholder — an unset pair really does fall
            // through to the harness selection on the Host side.
            modelPicker('AI 校对模型', 'proofreadProvider', 'proofreadModel', '只做错别字与标点这类机械校对，可以选便宜快的模型。'),
            NW.ui.field({
              label: 'AI 校对要求',
              hint: '这段要求会拼在校对提示词后面，与内置规则冲突时以你的为准。清空即恢复默认。',
              children: NW.ui.textarea({
                rows: 4,
                // R30: the default used to live only in the hint, so the box
                // looked empty and the writer had to invent the wording before
                // they could change a word of it. The default is now the actual
                // value, editable in place; an untouched default is stored as
                // '' so a future change to the text still reaches everyone.
                value: String(draft.proofreadRules || NW.aiProofreadDefaultRules()),
                placeholder: NW.aiProofreadDefaultRules(),
                onChange: (v) =>
                  set(
                    'proofreadRules',
                    String(v || '').trim() === NW.aiProofreadDefaultRules().trim() ? '' : v,
                  ),
                ariaLabel: 'AI 校对要求',
              }),
            }),
            modelPicker('AI 投稿模型', 'submitProvider', 'submitModel', '生成投稿邮件正文与按期刊要求排版时使用。'),
            modelPicker('AI 修改建议模型', 'adviceProvider', 'adviceModel', '通读全章给出修改建议，建议用能力更强的模型。'),
          ),
        ),
        // -------------------------------------------------- 3 导出与文件 ----
        section(
          '导出与文件',
          h(
            'div',
            null,
            NW.ui.field({
              label: '默认导出格式',
              children: NW.ui.select({
                value: draft.exportFormat || 'docx',
                onChange: (v) => set('exportFormat', v),
                options: ['docx', 'pdf', 'epub', 'txt'].map((value) => ({ value: value, label: formatLabelOf(value) })),
              }),
            }),
            // R35 ②: one click for the whole library. It sits next to the format
            // field because that is the format it will use — no second dialog,
            // no per-book file picker.
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, NW.t('一键导出全部书籍')),
              h(
                'span',
                { className: 'nw-inline', style: { gap: '6px' } },
                h('span', { className: 'nw-dim' }, NW.t('每部作品一个文件，打成一个 zip')),
                NW.ui.btn({
                  onClick: () => {
                    if (typeof p.onExportAll !== 'function') return;
                    const format = String(draft.exportFormat || 'docx');
                    p.onExportAll({
                      format: format,
                      includeMeta: draft.exportIncludeMeta !== false,
                      appendOn: draft.exportSignatureOn === true,
                      appendText: String(draft.exportSignature || ''),
                      options: { includeMeta: draft.exportIncludeMeta !== false, pageBreaks: true, toc: false },
                    });
                  },
                  disabled: typeof p.onExportAll !== 'function',
                  children: NW.t('导出全部…'),
                }),
              ),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '导出附加项'),
              h('span', { className: 'nw-dim' }, draft.exportSignatureOn ? '已开启文末追加' : '未开启文末追加'),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '版本历史'),
              NW.ui.btn({
                onClick: () => openSibling(p, 'versions', { chapterId: (p.chapter && p.chapter.id) || '' }),
                children: '查看快照…',
              }),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '自动保存与恢复'),
              h(
                'span',
                { className: 'nw-inline', style: { gap: '6px' } },
                h('span', { className: 'nw-dim' }, summaryOf(libState)),
                NW.ui.btn({ onClick: () => openSibling(p, 'backup', {}), children: '打开设置…' }),
              ),
            ),
          ),
        ),
        // ------------------------------------------------ 4 隐私与锁定 ----
        section(
          '隐私与锁定',
          h(
            'div',
            null,
            rowToggle(NW.t('自动锁定'), draft.lockEnabled, (v) => set('lockEnabled', v)),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '离开后自动锁定（分钟）'),
              NW.ui.input({
                type: 'number',
                value: draft.autoLockMinutes || 15,
                onChange: (v) => set('autoLockMinutes', Math.max(1, Number(v) || 15)),
                style: { width: '90px' },
              }),
            ),
            h('div', { className: 'nw-row' }, h('span', null, '正文加密存储'), NW.ui.toggle({
              checked: !!draft.encryption,
              onChange: (v) => {
                // Flipping the flag must also rewrite the rows already on disk,
                // otherwise "enabled" only affects future saves.
                if (typeof p.onToggleEncryption === 'function') {
                  Promise.resolve(p.onToggleEncryption(v))
                    .then((ok) => {
                      if (!ok) setDraft((prev) => Object.assign({}, prev, { encryption: !v }));
                    })
                    .catch(() => {
                      setDraft((prev) => Object.assign({}, prev, { encryption: !v }));
                    });
                  setDraft((prev) => Object.assign({}, prev, { encryption: v }));
                } else {
                  set('encryption', v);
                }
              },
              label: '正文加密存储',
            })),
            pwState.has
              ? h(
                  'div',
                  { style: { marginTop: '8px' } },
                  NW.ui.field({
                    label: '当前密码',
                    children: NW.ui.input({
                      type: 'password',
                      value: pwState.oldValue,
                      onChange: (v) => setPwState((prev) => Object.assign({}, prev, { oldValue: v, error: '' })),
                      placeholder: '修改密码前需要验证当前密码',
                    }),
                  }),
                  NW.ui.field({
                    label: '新密码',
                    children: NW.ui.input({
                      type: 'password',
                      value: pwState.nextValue,
                      onChange: (v) => setPwState((prev) => Object.assign({}, prev, { nextValue: v, error: '' })),
                      placeholder: '至少 4 位',
                    }),
                  }),
                  NW.ui.field({
                    label: '清除密码（输入当前密码）',
                    children: NW.ui.input({
                      type: 'password',
                      value: pwState.value,
                      onChange: (v) => setPwState((prev) => Object.assign({}, prev, { value: v, error: '' })),
                    }),
                  }),
                  h(
                    'div',
                    { className: 'nw-inline', style: { gap: '6px' } },
                    NW.ui.btn({ kind: 'primary', onClick: setPassword, disabled: !!busy, children: '修改密码' }),
                    NW.ui.btn({ kind: 'danger', onClick: clearPassword, disabled: !!busy, children: '清除密码' }),
                  ),
                )
              : h(
                  'div',
                  { style: { marginTop: '8px' } },
                  NW.ui.field({
                    label: NW.t('设置密码'),
                    children: NW.ui.input({
                      type: 'password',
                      value: pwState.value,
                      onChange: (v) => setPwState((prev) => Object.assign({}, prev, { value: v, error: '' })),
                      placeholder: '至少 4 位',
                    }),
                  }),
                  NW.ui.btn({ kind: 'primary', onClick: setPassword, disabled: !!busy, children: NW.t('设置密码') }),
                ),
            pwState.error ? h('div', { className: 'nw-lock-error', role: 'alert' }, pwState.error) : null,
            h(
              'p',
              { className: 'nw-hint-block' },
              '密码只在本机用 PBKDF2-SHA256 派生的密钥校验，正文用 AES-256-GCM 加密；忘记密码将无法恢复正文。',
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '立即锁定'),
              NW.ui.btn({ onClick: () => { if (typeof p.onLock === 'function') p.onLock(); }, children: NW.t('锁定') }),
            ),
          ),
        ),
        // ------------------------------------------------------ 5 投稿 ----
        section(
          '投稿',
          h(
            'div',
            null,
            h(
              'p',
              { className: 'nw-hint-block' },
              smtp.configured
                ? '已配置投稿邮箱' + (smtp.user ? '（' + smtp.user + '）' : '') + '。'
                : '还没有配置投稿邮箱。填好下面的服务器信息后，投稿助手就能直接发信。',
            ),
            // One-click provider presets: typing smtp.qq.com + 465 + SSL by hand
            // was the single most common source of "连接已关闭".
            presets.length > 0
              ? NW.ui.field({
                  label: '快速填写',
                  hint: '选择你的邮箱服务商，主机与端口会自动填好；密码处仍需填「授权码 / 客户端专用密码」。',
                  children: h(
                    'div',
                    { className: 'nw-preset-wrap' },
                    presets.map((preset) =>
                      h(
                        'button',
                        {
                          key: preset.id,
                          type: 'button',
                          className: 'nw-preset',
                          title: preset.note || preset.name,
                          onClick: () => {
                            setSmtp((prev) =>
                              Object.assign({}, prev, {
                                host: preset.host || prev.host,
                                port: String(preset.port || prev.port),
                                secure: preset.secure !== false,
                                error: '',
                                hint: preset.note || '',
                              }),
                            );
                          },
                        },
                        preset.name,
                      ),
                    ),
                  ),
                })
              : null,
            NW.ui.field({
              label: 'SMTP 主机',
              children: NW.ui.input({
                value: smtp.host,
                placeholder: '例如 smtp.qq.com',
                onChange: (v) => setSmtp((prev) => Object.assign({}, prev, { host: v, error: '', hint: '' })),
              }),
            }),
            h(
              'div',
              { className: 'nw-grid2' },
              NW.ui.field({
                label: '端口',
                children: NW.ui.input({
                  type: 'number',
                  value: smtp.port,
                  onChange: (v) => setSmtp((prev) => Object.assign({}, prev, { port: String(v), error: '', hint: '' })),
                  style: { maxWidth: '120px' },
                }),
              }),
              NW.ui.field({
                label: 'TLS / SSL',
                children: h(
                  'div',
                  { style: { paddingTop: '4px' } },
                  NW.ui.toggle({
                    checked: !!smtp.secure,
                    onChange: (v) => setSmtp((prev) => Object.assign({}, prev, { secure: v })),
                    label: '使用 SSL',
                    title: '465 端口通常用 SSL；587 端口通常关闭此项改用 STARTTLS。',
                  }),
                ),
              }),
            ),
            NW.ui.field({
              label: '用户名（发件邮箱）',
              children: NW.ui.input({
                value: smtp.user,
                placeholder: '例如 you@qq.com',
                onChange: (v) => setSmtp((prev) => Object.assign({}, prev, { user: v, error: '', hint: '' })),
              }),
            }),
            NW.ui.field({
              label: '密码 / 授权码',
              hint: '多数邮箱需要用「授权码」，不是网页登录密码。留空表示沿用已保存的密码。',
              children: NW.ui.input({
                type: 'password',
                value: smtp.password,
                placeholder: smtp.hasPassword ? '已保存，留空则不修改' : '',
                onChange: (v) => setSmtp((prev) => Object.assign({}, prev, { password: v, error: '', hint: '' })),
              }),
            }),
            h(
              'div',
              { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap' } },
              NW.ui.btn({ kind: 'primary', onClick: saveSmtp, disabled: !!smtp.busy, children: NW.t('保存') }),
              NW.ui.btn({ onClick: testSmtp, disabled: !!smtp.busy || !smtp.configured, children: NW.t('测试连接') }),
            ),
            smtp.busy ? h('div', { className: 'nw-inline', style: { marginTop: '8px' } }, NW.ui.spinner(smtp.busy)) : null,
            smtp.error
              ? h('div', { className: 'nw-lock-error', role: 'alert' }, smtp.error)
              : smtp.hint
                ? h('p', { className: 'nw-hint-block' }, smtp.hint)
                : null,
            // ---- 收件箱（IMAP）----
            // 投稿是「发信」，编辑部的回信要「收信」，两者是同一套账号；把收件
            // 摆在同一节里，作者才不用去猜「我该填哪个服务器」。
            h('hr', { className: 'nw-rule' }),
            h(
              'p',
              { className: 'nw-hint-block' },
              imap.configured
                ? '收件箱已配置' + (imap.user ? '（' + imap.user + '）' : '') + '，首页会显示编辑部的最新回信。'
                : '配好收信服务器后，首页会显示编辑部的最新回信和未读数；不配置也能正常投稿，只是回信要自己去网页邮箱看。',
            ),
            imapPresets.length > 0
              ? NW.ui.field({
                  label: '快速填写',
                  hint: '选服务商会自动填好 IMAP 主机与端口；密码同样要填授权码。',
                  children: h(
                    'div',
                    { className: 'nw-preset-wrap' },
                    imapPresets.map((preset) =>
                      h(
                        'button',
                        {
                          key: 'imap-' + preset.id,
                          type: 'button',
                          className: 'nw-preset',
                          title: preset.note || preset.name,
                          onClick: () => {
                            setImap((prev) =>
                              Object.assign({}, prev, {
                                enabled: true,
                                useSmtp: false,
                                host: preset.host || prev.host,
                                port: String(preset.port || prev.port),
                                secure: preset.secure !== false,
                                error: '',
                                hint: preset.note || '',
                              }),
                            );
                          },
                        },
                        preset.name,
                      ),
                    ),
                  ),
                })
              : null,
            rowToggle(
              '启用收件箱',
              imap.enabled,
              (v) => setImap((prev) => Object.assign({}, prev, { enabled: !!v })),
              '关闭后首页不再读取收件箱，设置仍保留。',
            ),
            rowToggle(
              '沿用发信账号',
              imap.useSmtp,
              (v) =>
                setImap((prev) =>
                  Object.assign({}, prev, {
                    useSmtp: !!v,
                    host: v ? '' : prev.host,
                    user: v ? '' : prev.user,
                  }),
                ),
              '打开时自动用上面 SMTP 的邮箱地址与授权码收信，只需在服务器名与 SMTP 对不上时手动填。',
            ),
            NW.ui.field({
              label: 'IMAP 主机',
              children: NW.ui.input({
                value: imap.host,
                placeholder: imap.useSmtp ? '留空则自动用 SMTP 主机推导（smtp.qq.com → imap.qq.com）' : '例如 imap.qq.com',
                onChange: (v) => setImap((prev) => Object.assign({}, prev, { host: v, error: '', hint: '' })),
              }),
            }),
            h(
              'div',
              { className: 'nw-grid2' },
              NW.ui.field({
                label: '端口',
                children: NW.ui.input({
                  type: 'number',
                  value: imap.port,
                  onChange: (v) => setImap((prev) => Object.assign({}, prev, { port: String(v), error: '', hint: '' })),
                  style: { maxWidth: '120px' },
                }),
              }),
              NW.ui.field({
                label: 'TLS / SSL',
                children: h(
                  'div',
                  { style: { paddingTop: '4px' } },
                  NW.ui.toggle({
                    checked: !!imap.secure,
                    onChange: (v) => setImap((prev) => Object.assign({}, prev, { secure: v })),
                    label: '使用 SSL',
                    title: '993 端口用 SSL；143 端口关闭此项改用 STARTTLS。',
                  }),
                ),
              }),
            ),
            NW.ui.field({
              label: '收件账号',
              hint: imap.useSmtp ? '留空则用 SMTP 用户名收信。' : '',
              children: NW.ui.input({
                value: imap.user,
                placeholder: imap.useSmtp ? '留空则沿用发信邮箱' : '例如 you@qq.com',
                onChange: (v) => setImap((prev) => Object.assign({}, prev, { user: v, error: '', hint: '' })),
              }),
            }),
            NW.ui.field({
              label: '密码 / 授权码',
              hint: '留空表示沿用已保存的密码（SMTP 那份也能用）。',
              children: NW.ui.input({
                type: 'password',
                value: imap.password,
                placeholder: imap.hasPassword ? '已保存，留空则不修改' : '',
                onChange: (v) => setImap((prev) => Object.assign({}, prev, { password: v, error: '', hint: '' })),
              }),
            }),
            h(
              'div',
              { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap' } },
              NW.ui.btn({ kind: 'primary', onClick: saveImap, disabled: !!imap.busy, children: NW.t('保存') }),
              NW.ui.btn({
                onClick: testImap,
                disabled: !!imap.busy || !imap.configured,
                children: '测试收件箱',
              }),
            ),
            imap.busy ? h('div', { className: 'nw-inline', style: { marginTop: '8px' } }, NW.ui.spinner(imap.busy)) : null,
            imap.error
              ? h('div', { className: 'nw-lock-error', role: 'alert' }, imap.error)
              : imap.hint
                ? h('p', { className: 'nw-hint-block' }, imap.hint)
                : null,
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '默认署名'),
              NW.ui.input({
                value: String(draft.penName || ''),
                placeholder: '投稿时使用的笔名',
                onChange: (v) => set('penName', v),
                style: { maxWidth: '220px' },
              }),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '默认联系方式'),
              NW.ui.input({
                value: String(draft.contactInfo || ''),
                placeholder: '手机 / 微信 / 其它',
                onChange: (v) => set('contactInfo', v),
                style: { maxWidth: '220px' },
              }),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '默认回信邮箱'),
              NW.ui.input({
                value: String(draft.contactEmail || ''),
                placeholder: '编辑回复用的邮箱',
                onChange: (v) => set('contactEmail', v),
                style: { maxWidth: '220px' },
              }),
            ),
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '期刊清单'),
              h(
                'span',
                { className: 'nw-inline', style: { gap: '6px' } },
                h('span', { className: 'nw-dim' }, journalCount == null ? '' : journalCount + ' 家'),
                NW.ui.btn({ onClick: openJournals, children: '打开投稿助手…' }),
              ),
            ),
            h(
              'p',
              { className: 'nw-hint-block' },
              '期刊的邮箱与投稿要求以官方最新征稿启事为准，可在投稿助手的「期刊管理」里核对后保存。',
            ),
          ),
          { ref: submitSectionRef },
        ),
        // ------------------------------------------------------ 6 手机同步 ----
        // R38 fix: `section(title, children, extra)` renders exactly one child. The
        // variadic call written here dropped everything after the intro paragraph —
        // the panel, the sync status and the LAN addresses never reached the DOM,
        // and the pairing element ended up spread onto the <section> as props.
        section(
          '手机同步',
          h(
            'div',
            null,
            [
            h('p', { className: 'nw-hint-block' }, '手机装好 App 后配对一次即可。之后只要在同一个 Wi-Fi 下，修改会自动双向同步；不同书各自保留，同一本书以最后修改时间为准。'),
            // R38: the pairing panel is rendered in place instead of behind a button
            // that swapped this window for another one. The values a phone needs are
            // what people come here for; hiding them one click deeper was the bug.
            h(PairPanel, { onToast: typeof p.onToast === 'function' ? p.onToast : null }),
            // R36: users who turned on 正文加密 need to know that syncing does not
            // carry the encryption to the phone — the desktop decrypts on the way
            // out, because the phone has no key and never will.
            draft.encryption === true
              ? h('p', { className: 'nw-hint-block' }, '正文加密已开启：同步时桌面会先解密再交给手机，所以手机上看到的是明文；同步缓存仍用本机密钥加密存放。')
              : null,
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '同步状态'),
              h(
                'span',
                { className: 'nw-dim' },
                // R38: a phone sync never touches the browser's own counters — it goes
                // host-to-phone — so `lastSyncAt` (written by the host when a phone
                // merges) is the honest answer. The browser counters stay as a
                // fallback for the old in-page sync paths.
                lanSync && lanSync.lastSyncAt
                  ? NW.t('最近一次同步 {0}', NW.fmtDate(lanSync.lastSyncAt))
                  : lanSync && lanSync.pulledAt
                    ? NW.t('最近一次收到手机改动 {0}', NW.fmtDate(lanSync.pulledAt))
                    : lanSync && lanSync.lastPushAt
                      ? NW.t('最近一次交给同步 {0}', NW.fmtDate(lanSync.lastPushAt))
                      : NW.t('还没有同步过'),
              ),
            ),
            // Why the address is spelled out even though there is a QR: the phone
            // sometimes cannot use a camera (emulator, cracked screen), and the
            // number is also the fastest way to tell whether the desktop is on the
            // same subnet as the phone at all.
            lanSync && lanSync.lan && lanSync.lan.running && lanSync.lan.addresses && lanSync.lan.addresses.length
              ? h(
                  'div',
                  { className: 'nw-row' },
                  h('span', null, '局域网地址'),
                  h('span', { className: 'nw-dim' }, lanSync.lan.addresses.map((row) => row.url).join('  ·  ')),
                )
              : h(
                  'div',
                  { className: 'nw-row' },
                  h('span', null, '局域网地址'),
                  h('span', { className: 'nw-dim' }, '未启动（生成配对码时会自动启动）'),
                ),
            ],
          ),
        ),
        // ---------------------------------------------------- 7 快捷键 ----
        section(
          '快捷键',
          h(
            'div',
            { className: 'nw-kbd-list' },
            [
              ['Ctrl / ⌘ + S', NW.t('保存')],
              ['Ctrl / ⌘ + B', '加粗'],
              ['Ctrl / ⌘ + I', '斜体'],
              ['Ctrl / ⌘ + F', NW.t('查找替换')],
              ['Ctrl / ⌘ + Shift + L', NW.t('锁定')],
              // R22: the two new in-editor shortcuts.
              ['Alt + N', NW.t('新章节')],
              ['Alt + A', NW.t('修改建议')],
              ['Tab', '插入两个全角空格'],
            ].map((row) => h('div', { key: row[0], className: 'nw-kbd-row' }, h('kbd', null, row[0]), h('span', null, row[1]))),
          ),
        ),
        busy ? h('div', { className: 'nw-inline' }, NW.ui.spinner(busy)) : null,
        ),
      ),
      h('div', { style: { display: 'flex', gap: '8px' } }, closeBtn(p)),
      '780px',
      p.onClose,
    );
  };

  /** One sentence of next-step advice for the two or three SMTP failures users hit. */
  function smtpHintFor(code, message) {
    const text = String(message || '');
    if (code === 'smtp-not-configured' || /未配置|not-configured/.test(code + text)) {
      return '先填好上面的主机、端口、用户名与授权码，点「保存」后再测试。';
    }
    if (/EAUTH|535|认证|auth|授权码|password/i.test(text)) {
      return '认证失败通常是授权码不对：QQ 邮箱要先用「设置 → 账户 → 生成授权码」，且账号与授权码要配对。';
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|超时|network/i.test(text)) {
      return '连不上服务器：检查主机名拼写、网络是否放行该端口（465/587），或换一个邮箱服务商。';
    }
    if (/ESOCKET|SSL|TLS|certificate|证书/i.test(text)) {
      return 'SSL / TLS 不匹配：465 端口请打开「TLS / SSL」开关，587 端口请关闭它改用 STARTTLS。';
    }
    return '可以先用网页版邮箱确认能正常登录，再回来重试；也可以直接复制预览里的邮件内容手动发送。';
  }

  // ============================================================== Submit ====
  // R8/R9 ③: the wizard argues from the manuscript outwards — pick the work,
  // then the journal that wants it, then read the mail exactly as it will be
  // sent. Nothing is decided on the user's behalf past step 3: journal, inbox,
  // subject, body, attachments and their filenames all stay editable in the
  // preview, which is where the automation is supposed to stop.
  NW.dialogs.Submit = function Submit(props) {
    const p = props || {};
    const settings = p.settings || {};
    const openedNovel = p.novel || {};
    const novelList = (Array.isArray(p.novels) ? p.novels : []).filter((row) => row && row.id);
    const allChapters = (Array.isArray(p.chapters) ? p.chapters : []).filter(Boolean);
    const [novelId, setNovelId] = useState(
      String((p.dialog && p.dialog.novelId) || openedNovel.id || (novelList[0] && novelList[0].id) || ''),
    );
    const activeNovel =
      novelList.filter((row) => String(row.id) === String(novelId))[0] ||
      (String(openedNovel.id || '') === String(novelId) ? openedNovel : null) ||
      {};
    const chapters = allChapters.filter((row) => String(row.novelId) === String(novelId));
    /**
     * R16 ⑧: novels carry no word count of their own — only chapters do — so the
     * book picker used to print `0 字` for every title. Sum the chapter counts
     * once here and use that everywhere the book's size is shown.
     */
    const bookWords = (() => {
      const map = {};
      for (let i = 0; i < allChapters.length; i += 1) {
        const row = allChapters[i];
        if (!row) continue;
        const key = String(row.novelId || '');
        if (!key) continue;
        map[key] = (map[key] || 0) + (Number(row.wordCount) || 0);
      }
      return map;
    })();
    const currentChapter =
      p.chapter && String(p.chapter.novelId == null ? novelId : p.chapter.novelId) === String(novelId) ? p.chapter : null;

    const initialStep = (() => {
      const want = Number((p.dialog && p.dialog.step) || 1);
      return want >= 1 && want <= 3 ? Math.floor(want) : 1;
    })();
    const [step, setStep] = useState(initialStep);

    const [journals, setJournals] = useState(null);
    const [journalsError, setJournalsError] = useState('');
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(String((p.dialog && p.dialog.journalId) || ''));
    const [manage, setManage] = useState(false);
    const [editEmail, setEditEmail] = useState('');
    const [editEmailRows, setEditEmailRows] = useState([]);
    const [editRange, setEditRange] = useState('');
    const [editTier, setEditTier] = useState('other');
    const [editRequirements, setEditRequirements] = useState('');
    const [manageBusy, setManageBusy] = useState('');

    // ---- step 1: which work goes out ----
    const [scope, setScope] = useState('novel');
    const [pickedIds, setPickedIds] = useState([]);
    const [genre, setGenre] = useState('');
    const [genreTouched, setGenreTouched] = useState(false);
    const [workRows, setWorkRows] = useState(null);
    const [workBusy, setWorkBusy] = useState(false);
    /** Ranked journal candidates for this manuscript (`[{journal, score, reasons, match?}]`). */
    const [recos, setRecos] = useState(null);
    /** `'model' | 'rules'` + optional note — surfaced so the card never overclaims. */
    const [recoMeta, setRecoMeta] = useState(null);
    const [recoBusy, setRecoBusy] = useState(false);

    /** Mail identity — editable in the preview, prefilled from settings. */
    const [form, setForm] = useState({
      penName: String(settings.penName || ''),
      email: String(settings.contactEmail || ''),
      contact: String(settings.contactInfo || ''),
      signature: String(settings.penName || ''),
    });

    const [smtp, setSmtp] = useState({ configured: false, user: '', loading: true });
    const [preparing, setPreparing] = useState(false);
    const [prepared, setPrepared] = useState(null);
    /**
     * `{email, note, band, bandLabel, matched, variants}` for the selected
     * journal + this manuscript. `matched` tells us whether we hit a
     * genre/length specific inbox or the journal's general one.
     */
    const [emailInfo, setEmailInfo] = useState(null);
    const [prepareError, setPrepareError] = useState('');
    // R32 ①: the progress panel steps through these while the host works. The
    // tick is cosmetic — it never gats the request, it only keeps the screen
    // telling the truth ("something is happening") on a slow model.
    const [prepareTick, setPrepareTick] = useState(0);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    /** Editable inbox — the resolved address is a suggestion, not a cage. */
    const [toDraft, setToDraft] = useState('');
    /** Editable attachment rows: `{filename, mime, base64, source}`. */
    const [attachRows, setAttachRows] = useState([]);
    const [attachBusy, setAttachBusy] = useState('');
    const [fullBody, setFullBody] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState('');
    const [sent, setSent] = useState(null);
    const [records, setRecords] = useState(null);

    // ③ 邮件预览 — every attachment gets a 预览 button that renders its text
    // through the host importer, so the author can confirm what the editor opens.
    const [attachmentPreview, setAttachmentPreview] = useState(null);
    const [attachmentBusy, setAttachmentBusy] = useState('');

    const openAttachment = async (row) => {
      const filename = String((row && row.filename) || '');
      if (!filename || !row || !row.base64) return;
      setAttachmentBusy(filename);
      try {
        const data = await NW.io.submit.attachment({ name: filename, base64: row.base64 });
        setAttachmentPreview({
          filename: filename,
          text: String((data && data.text) || ''),
          chars: Number((data && data.chars) || 0),
          truncated: !!(data && data.truncated),
          chapters: Number((data && data.chapters) || 0),
        });
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '无法打开该附件'), 'warn');
      } finally {
        setAttachmentBusy('');
      }
    };

    /**
     * R10 ⑤: let the author download an attachment exactly as the editor will
     * receive it. Being able to open the very same bytes is the only honest way
     * to judge the formatting — a text preview cannot show spacing or fonts.
     */
    const downloadAttachment = (row) => {
      const filename = String((row && row.filename) || '附件');
      if (!row || !row.base64) {
        if (typeof p.onToast === 'function') p.onToast('这个附件还没有内容，无法下载', 'warn');
        return;
      }
      try {
        const bytes = NW.io.fromBase64(row.base64);
        const blob = new Blob([bytes], { type: row.mime || 'application/octet-stream' });
        NW.io.download(filename, blob);
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '下载附件失败'), 'error');
      }
    };

    const addAttachmentFiles = async () => {
      if (!(NW.io && NW.io.pickFiles)) return;
      setAttachBusy('读取文件…');
      try {
        const files = await NW.io.pickFiles();
        const rows = [];
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (!file) continue;
          const base64 = await fileToBase64(file);
          if (!base64) continue;
          rows.push({
            filename: String(file.name || '附件'),
            mime: String(file.type || 'application/octet-stream'),
            base64: base64,
            source: 'local',
          });
        }
        if (rows.length) setAttachRows((prev) => prev.concat(rows));
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '读取附件失败'), 'error');
      } finally {
        setAttachBusy('');
      }
    };

    // ------------------------------------------------------------- journals --
    const loadJournals = async () => {
      if (!(NW.io && NW.io.journals && NW.io.journals.list)) {
        setJournalsError('当前版本不支持期刊清单');
        setJournals([]);
        return;
      }
      try {
        const data = await NW.io.journals.list();
        const rows = data && Array.isArray(data.journals) ? data.journals : [];
        setJournals(rows);
        setJournalsError(rows.length ? '' : '期刊清单为空');
      } catch (err) {
        setJournals([]);
        setJournalsError(errText(err, '读取期刊清单失败'));
      }
    };

    useEffect(() => {
      loadJournals();
      if (NW.io && NW.io.submit && NW.io.submit.smtpStatus) {
        NW.io.submit
          .smtpStatus()
          .then((data) =>
            setSmtp({ configured: !!(data && data.configured), user: String((data && data.user) || ''), loading: false }),
          )
          .catch(() => setSmtp({ configured: false, user: '', loading: false }));
      } else {
        setSmtp({ configured: false, user: '', loading: false });
      }
    }, []);

    const list = journals || [];
    const filtered = list.filter((entry) => {
      const text = String(query || '').trim().toLowerCase();
      if (!text) return true;
      const names = [entry.name].concat(Array.isArray(entry.aliases) ? entry.aliases : []);
      return names.some((name) => String(name || '').toLowerCase().indexOf(text) >= 0);
    });
    const selected = list.filter((entry) => String(entry.id) === String(selectedId))[0] || null;

    // ---------------------------------------------------------- manuscript ---
    /**
     * Read the chosen scope into `{title, content}` rows. Live editor text wins
     * for the current chapter, everything else comes from IndexedDB so a stale
     * sidebar row cannot submit an old draft.
     */
    const collectWork = async () => {
      const out = [];
      if (!novelId) return out;
      if (scope === 'chapter') {
        if (!currentChapter) return out;
        let text = typeof p.getText === 'function' ? String(p.getText() || '') : '';
        if (!text) text = textOfChapter(currentChapter);
        out.push({ title: String(currentChapter.title || '第 1 章'), content: text });
        return out;
      }
      const rows = scope === 'custom' ? chapters.filter((row) => pickedIds.indexOf(String(row.id)) >= 0) : chapters;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        let content = textOfChapter(row);
        if (!content && NW.db && typeof NW.db.getChapter === 'function') {
          try {
            const full = await NW.db.getChapter(row.id);
            if (full) content = textOfChapter(full);
          } catch (err) {
            content = textOfChapter(row);
          }
        }
        out.push({ title: String(row.title || '第 ' + (i + 1) + ' 章'), content: content });
      }
      return out;
    };

    // Step 1 already needs the word count (it drives the genre band and every
    // later address lookup), so this runs from the first render and re-runs
    // whenever the chosen book or scope changes.
    useEffect(() => {
      let alive = true;
      setWorkBusy(true);
      collectWork()
        .then((rows) => {
          if (!alive) return;
          setWorkRows(rows);
          const count = rows.reduce((sum, row) => sum + countCharsOf(row.content), 0);
          if (!genreTouched) setGenre(suggestGenreOf(count));
        })
        .catch(() => {
          if (alive) setWorkRows([]);
        })
        .finally(() => {
          if (alive) setWorkBusy(false);
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [novelId, scope, pickedIds.join(','), chapters.length]);

    const workCount = (workRows || []).reduce((sum, row) => sum + countCharsOf(row.content), 0);
    const recommendedGenre = suggestGenreOf(workCount);

    // R27 ③: hand the opening of the manuscript to the model and let it judge
    // fit + quality, instead of ranking journals by arithmetic. The rule ranker
    // still runs on the Host as the shortlist filter and as the fallback — the
    // response says which one answered (`by`), so the card can be honest about
    // whether a model actually read this manuscript.
    useEffect(() => {
      let alive = true;
      if (workRows == null || !(NW.io && NW.io.journals && NW.io.journals.recommend)) return undefined;
      const rows = workRows || [];
      const count = rows.reduce((sum, row) => sum + countCharsOf(row.content), 0);
      // First ~2400 characters of the piece: enough for voice and subject, cheap
      // enough to run on every entry to step 2. `textOfChapter` already handles
      // the "content was dropped by the lock" case by reading it back from IDB.
      const excerpt = rows.map((row) => textOfChapter(row)).join('\n\n').slice(0, 2400);
      setRecoBusy(true);
      NW.io.journals
        .recommend(
          { wordCount: count, genre: suggestGenreOf(count), title: String((activeNovel && activeNovel.title) || '') },
          6,
          { excerpt, provider: settings.submitProvider || settings.proofreadProvider, model: settings.submitModel || settings.proofreadModel },
        )
        .then((data) => {
          if (!alive) return;
          setRecos(Array.isArray(data && data.recommendations) ? data.recommendations : []);
          setRecoMeta({ by: String((data && data.by) || 'rules'), note: String((data && data.note) || '') });
        })
        .catch(() => {
          if (!alive) return;
          setRecos([]);
          setRecoMeta(null);
        })
        .then(() => {
          if (alive) setRecoBusy(false);
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workRows]);

    // R6: resolve the inbox for this exact manuscript. Same journal, same genre,
    // different length can mean a different address, so this re-runs whenever the
    // selection or the word count changes and always shows the reason.
    useEffect(() => {
      let alive = true;
      if (!selectedId || !(NW.io && NW.io.journals && NW.io.journals.email)) {
        setEmailInfo(null);
        return undefined;
      }
      const chosenGenre = genre || suggestGenreOf(workCount);
      NW.io.journals
        .email(selectedId, { genre: chosenGenre, wordCount: workCount })
        .then((data) => {
          if (!alive) return;
          setEmailInfo((data && data.resolved) || null);
        })
        .catch(() => {
          if (alive) setEmailInfo(null);
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, genre, workCount]);

    /**
     * The address this mail will go to: what the host resolved, unless edited.
     *
     * R30: never fall back to `form.email`. That is the writer's own sending
     * address, and falling back to it meant "the journal has no inbox on file"
     * quietly became "post this letter to yourself" — the To field is prefilled
     * with the exact address it will be sent from. An empty field that says
     * 待核对 is honest; a self-addressed submission is a lost submission.
     */
    const suggestedTo = String(
      (emailInfo && emailInfo.email) || (selected && selected.email) || '',
    ).trim();
    // R31 ②: the note has to explain the choice, not just name it. Three states:
    //   variant — a row keyed to this 体裁 matched, and the row says which;
    //   default — the journal publishes one address for everything;
    //   divided — the journal *does* publish per-体裁 inboxes but none matched
    //             this manuscript, so the generic one is a guess and says so.
    const emailNote = emailInfo
      ? [
          emailInfo.bandLabel ? NW.fmtWords(workCount) + ' 字 · ' + emailInfo.bandLabel : '',
          emailInfo.matched === 'variant'
            ? '已匹配体裁'
            : emailInfo.matched === 'default'
              ? '该刊只登记了一个通用邮箱'
              : emailInfo.matched === 'none'
                ? '该刊未登记收稿邮箱'
                : '',
          emailInfo.note || '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

    // R10 ⑥: every inbox the journal registers, with the one picked for this
    // manuscript marked. The address itself is shown in full — an editor's inbox
    // is not a secret, and the user has to be able to copy it by hand.
    const variantRows = emailInfo && Array.isArray(emailInfo.variants)
      ? emailInfo.variants
          .filter((row) => row && String(row.email || '').indexOf('@') > 0)
          .map((row, index) => {
            const tags = [];
            if (row.bandLabel) tags.push(String(row.bandLabel));
            const genreTags = ['weixiaoshuo', 'duanpian', 'zhongpian', 'changpian']
              .filter((key) => row.genres && row.genres[key])
              .map((key) => genreLabelOf(key));
            if (genreTags.length > 0) tags.push(genreTags.join('/'));
            if (Number(row.minWords) || Number(row.maxWords)) {
              tags.push(String(Number(row.minWords) || 0) + '–' + String(Number(row.maxWords) || 0) + '字');
            }
            if (row.note) tags.push(String(row.note));
            return h(
              'li',
              { key: 'variant-' + index, className: 'nw-variant-row', 'data-on': row.score > 0 ? '1' : '0' },
              h('span', { className: 'nw-variant-mail' }, String(row.email)),
              tags.length > 0 ? h('span', { className: 'nw-attach-hint' }, tags.join(' · ')) : null,
              row.score > 0 ? h('span', { className: 'nw-variant-pick' }, NW.t('本稿用这个')) : null,
            );
          })
      : [];

    useEffect(() => {
      if (!preparing) return undefined;
      setPrepareTick(0);
      const id = setInterval(() => {
        setPrepareTick((n) => (n >= 5 ? n : n + 1));
      }, 1100);
      return () => clearInterval(id);
    }, [preparing]);

    // -------------------------------------------------------------- prepare --
    // Only the newest preparation may write into the form: a slow model answer
    // for the journal the writer just switched away from must not overwrite the
    // letter, the recipient and the attachments of the new one.
    const prepareRunRef = useRef(0);
    const runPrepare = async () => {
      if (!(NW.io && NW.io.submit && NW.io.submit.prepare)) {
        setPrepareError('当前版本不支持投稿助手');
        return;
      }
      const runId = (prepareRunRef.current += 1);
      const stale = () => prepareRunRef.current !== runId;
      setPreparing(true);
      setPrepareError('');
      try {
        const rows = workRows || (await collectWork());
        if (!rows.length) throw new Error('请先选择要投稿的稿件');
        const preparePayload = {
          journal: selected
            ? { id: selected.id, name: selected.name, email: selected.email || '', requirements: selected.requirements || [] }
            : null,
          genre: genre || suggestGenreOf(workCount),
          work: { title: String(activeNovel.title || '未命名作品'), author: form.penName, chapters: rows },
          profile: {
            penName: form.penName,
            contact: form.contact,
            email: form.email,
            signature: form.signature,
          },
          // R16 ⑥: the host counts the manuscript for the subject line and the
          // preview, so it has to know whether 标点 is included.
          countPunctuation: !(
            p.settings && p.settings.countPunctuation === false
          ),
        };
        // R34: the letter is model-written, so a dead provider used to kill the
        // whole flow with a bare error. Walk the other models instead, and only
        // fall back to the picker when none of them answer.
        let data = null;
        let list = null;
        try {
          list = await NW.ai.models();
        } catch (err) {
          list = null;
        }
        const wantedProvider = (p.settings && p.settings.submitProvider) || undefined;
        const wantedModel = (p.settings && p.settings.submitModel) || undefined;
        const candidates = NW.ai.candidates
          ? NW.ai.candidates(list, { provider: wantedProvider, model: wantedModel })
          : [{ provider: wantedProvider, model: wantedModel, label: String(wantedModel || '默认模型') }];
        const attempts = [];
        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index];
          if (index > 0) setPrepareError(NW.t('换用 {0} 重试…', candidate.label));
          try {
            data = await NW.io.submit.prepare(
              Object.assign({}, preparePayload, { provider: candidate.provider, model: candidate.model }),
            );
            if (stale()) return;
            if (index > 0 && typeof p.onToast === 'function') {
              p.onToast(NW.t('原模型没有响应，已改用 {0}', candidate.label), 'warn');
            }
            setPrepareError('');
            break;
          } catch (err) {
            if (err && err.code === 'aborted') throw err;
            attempts.push({ label: candidate.label, message: String((err && err.message) || err || '失败') });
          }
        }
        if (!data) {
          const picked =
            typeof NW.askModel === 'function'
              ? await NW.askModel({ kind: 'submit', label: 'AI 投稿', tried: attempts, models: list, preferred: { provider: wantedProvider, model: wantedModel } })
              : null;
          if (!picked) {
            const detail = attempts.length ? attempts[attempts.length - 1].message : '生成邮件失败';
            const err = new Error(detail);
            err.tried = attempts;
            throw err;
          }
          data = await NW.io.submit.prepare(Object.assign({}, preparePayload, { provider: picked.provider, model: picked.model }));
          if (stale()) return;
          setPrepareError('');
        }
        setPrepared(data || null);
        setSubject(String((data && data.subject) || ''));
        setBody(String((data && data.body) || ''));
        const resolvedTo = String(
          (data && data.journalEmail) || (emailInfo && emailInfo.email) || (selected && selected.email) || '',
        ).trim();
        setToDraft(resolvedTo);
        setAttachRows(
          (data && Array.isArray(data.attachments) ? data.attachments : [])
            .filter((row) => row && row.base64)
            .map((row) => ({
              filename: String(row.filename || '附件'),
              mime: String(row.mime || 'application/octet-stream'),
              base64: String(row.base64),
              source: 'host',
            })),
        );
        if (data && data.genre && !genreTouched) setGenre(String(data.genre));
        const warnings = data && Array.isArray(data.warnings) ? data.warnings : [];
        if (warnings.length && typeof p.onToast === 'function') p.onToast(warnings[0], 'info');
      } catch (err) {
        if (stale()) return;
        setPrepareError(errText(err, '生成邮件失败'));
      } finally {
        if (!stale()) setPreparing(false);
      }
    };

    // The preview belongs to one journal + one manuscript. Changing either has to
    // throw the old letter away, otherwise the prepare effect below sees a stale
    // `prepared` and never re-runs — the author would be reading (and could send)
    // the previous journal's mail. The token forces that re-generation even
    // though `step` stayed at 3.
    const [prepareToken, setPrepareToken] = useState(0);
    const discardPrepared = useCallback(() => {
      // Bumped so any preparation still in flight knows its answer is obsolete.
      prepareRunRef.current += 1;
      // The stale run will not clear this itself (its finally only touches state
      // it still owns), so the spinner has to be released here.
      setPreparing(false);
      setPrepared(null);
      setSent(null);
      setSendError('');
      setPrepareError('');
      setPrepareToken((n) => n + 1);
    }, []);

    useEffect(() => {
      discardPrepared();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, novelId, scope, pickedIds.join(','), discardPrepared]);

    // R28 ②: 一键 AI 投稿 opens the wizard on step 3 with no journal chosen yet.
    // The recommendation effect above is already reading this manuscript with the
    // model, so the top row *is* the model's answer — take it, and let the author
    // change it from the preview. Guarded on `step === 3` so browsing journals on
    // step 2 never gets a choice made behind the writer's back.
    useEffect(() => {
      if (step !== 3) return undefined;
      if (selectedId) return undefined;
      if (!recos || recos.length === 0) return undefined;
      const first = recos[0] && recos[0].journal;
      if (!first || !first.id) return undefined;
      setSelectedId(String(first.id));
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, recos, selectedId]);

    useEffect(() => {
      if (step !== 3 || sent) return undefined;
      if (prepared || preparing) return undefined;
      runPrepare();
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, prepareToken]);

    // ---------------------------------------------------------------- send ---
    const toAddress = String(toDraft || suggestedTo || '').trim();
    // R32 3: say which inbox this is. When the journal publishes four addresses
    // and the app silently picks one, the author has no way to tell whether the
    // pick was "the 中篇 desk" or "the only address we found".
    const matchedVariant =
      emailInfo && emailInfo.matched === 'variant'
        ? (Array.isArray(emailInfo.variants) ? emailInfo.variants : []).filter(
            (row) => row && row.qualified && String(row.email || '') === String(emailInfo.email || ''),
          )[0] || null
        : null;
    const toWhy = (() => {
      if (matchedVariant) {
        const bits = [];
        if (emailInfo.bandLabel) bits.push(String(emailInfo.bandLabel));
        const genres = Object.keys(matchedVariant.genres || {})
          .filter((key) => matchedVariant.genres[key])
          .map((key) => EMAIL_GENRE_LABELS[key] || key);
        if (genres.length) bits.push(genres.join('/'));
        return '按本稿篇幅匹配到这家刊的这一条收稿邮箱' + (bits.length ? '：' + bits.join(' · ') : '') + '。';
      }
      if (emailInfo && emailInfo.matched === 'default' && Array.isArray(emailInfo.variants) && emailInfo.variants.length) {
        return '这家刊分设了多个收稿邮箱，但当前篇幅没有单独对应的那一条，填的是通用邮箱，可核对后手动改。';
      }
      return '';
    })();

    const doSend = async () => {
      if (!(NW.io && NW.io.submit && NW.io.submit.send)) {
        setSendError('当前版本不支持发送投稿邮件');
        return;
      }
      if (!toAddress) {
        setSendError('缺少收件邮箱：请在期刊详情或上面的「收件人」里填写。');
        return;
      }
      if (!String(subject || '').trim()) {
        setSendError('邮件主题为空，请先补上。');
        return;
      }
      setSending(true);
      setSendError('');
      try {
        const attachments = (attachRows || [])
          .filter((row) => row && row.base64)
          .map((row) => ({
            filename: String(row.filename || '附件'),
            mime: String(row.mime || 'application/octet-stream'),
            base64: String(row.base64),
          }));
        const data = await NW.io.submit.send({
          to: toAddress,
          subject: subject,
          body: body,
          attachments: attachments,
          journalId: selected ? String(selected.id) : '',
          // R41 ③: the log follows the book by id; the title stays a snapshot of
          // what was actually mailed, so a rename cannot rewrite history.
          novelId: novelId ? String(novelId) : '',
          title: String((prepared && prepared.formatted && prepared.formatted.title) || activeNovel.title || ''),
          genre: String((prepared && prepared.genre) || genre || recommendedGenre || ''),
          wordCount: Number((prepared && prepared.wordCount) || workCount) || 0,
        });
        // The host reports "no SMTP account" inside a normal response instead of
        // throwing, so check the shape before celebrating.
        if (data && data.ok === false) {
          const code = String(data.code || '');
          setSendError(String(data.message || '发送失败'));
          if (code === 'smtp-not-configured') setSmtp((prev) => Object.assign({}, prev, { configured: false }));
          return;
        }
        setSent({ record: (data && data.record) || null, at: Date.now(), to: toAddress });
        if (typeof p.onToast === 'function') p.onToast('投稿邮件已发送', 'ok');
        if (typeof p.onSubmissionChanged === 'function') await p.onSubmissionChanged();
        if (NW.io && NW.io.submit && NW.io.submit.record) {
          try {
            const rows = await NW.io.submit.record();
            setRecords(rows && Array.isArray(rows.records) ? rows.records : []);
          } catch (err) {
            setRecords(null);
          }
        }
      } catch (err) {
        setSendError(errText(err, '发送投稿邮件失败'));
      } finally {
        setSending(false);
      }
    };

    // -------------------------------------------------------- journal edit --
    const startManage = () => {
      if (!selected) {
        if (typeof p.onToast === 'function') p.onToast('请先在左侧选择一家期刊', 'info');
        return;
      }
      setEditEmail(String(selected.email || ''));
      setEditEmailRows(variantRowsOf(selected.emails));
      setEditRange(String(selected.wordRange || ''));
      setEditTier(String(selected.tier || 'other'));
      const requirements = Array.isArray(selected.requirements) ? selected.requirements : [];
      setEditRequirements(requirements.join('\n'));
      setManage(true);
    };

    const saveManage = async () => {
      if (!selected) return;
      setManageBusy('正在保存期刊信息…');
      try {
        if (!(NW.io && NW.io.journals && NW.io.journals.save)) throw new Error('当前版本不支持保存期刊');
        const lines = String(editRequirements || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const entry = Object.assign({}, selected, {
          email: String(editEmail || '').trim(),
          emails: (Array.isArray(editEmailRows) ? editEmailRows : []).map(variantFromRow).filter(Boolean),
          wordRange: String(editRange || '').trim(),
          requirements: lines,
          tier: String(editTier || 'other'),
        });
        await NW.io.journals.save([entry]);
        await loadJournals();
        setManage(false);
        if (typeof p.onToast === 'function') p.onToast('期刊信息已保存', 'ok');
      } catch (err) {
        if (typeof p.onToast === 'function') p.onToast(errText(err, '保存期刊信息失败'), 'error');
      } finally {
        setManageBusy('');
      }
    };

    // -------------------------------------------------------------- render ---
    const steps = [
      { value: 1, label: '① 选小说' },
      { value: 2, label: '② 选期刊' },
      { value: 3, label: '③ 邮件预览' },
    ];

    const canNext = step === 1 ? !!novelId && workCount > 0 : step === 2 ? !!selected : true;

    const next = () => {
      if (step === 1 && !novelId) {
        if (typeof p.onToast === 'function') p.onToast('请先选择要投稿的小说', 'info');
        return;
      }
      if (step === 1 && workCount <= 0) {
        if (typeof p.onToast === 'function') p.onToast('所选稿件没有内容', 'info');
        return;
      }
      if (step === 2 && !selected) {
        if (typeof p.onToast === 'function') p.onToast('请先选择一家期刊', 'info');
        return;
      }
      // R12 ③: after the journal is picked the letter is already being built
      // (runPrepare fires on entering step 3), so "下一步" lands straight on the
      // preview instead of asking the author to press 生成 first.
      setStep(Math.min(3, step + 1));
    };

    const back = () => setStep(Math.max(1, step - 1));

    const stepBody = [];

    // ---- step 1 ---- the work is the subject of the sentence, so it comes first.
    if (step === 1) {
      stepBody.push(h('h4', null, '选择要投稿的小说'));

      if (novelList.length === 0) {
        stepBody.push(h('div', { className: 'nw-dim' }, '书架上还没有小说，请先回到写作页新建一部。'));
      }

      if (novelList.length > 0) {
        const bookButtons = novelList.map((row) =>
          h(
            'button',
            {
              key: String(row.id),
              type: 'button',
              className: 'nw-journal-item',
              'data-active': String(row.id) === String(novelId) ? '1' : '0',
              onClick: () => {
                setNovelId(String(row.id));
                setPickedIds([]);
                setScope('novel');
                setGenreTouched(false);
              },
            },
            h('span', null, String(row.title || '未命名小说')),
            h(
              'span',
              { className: 'nw-dim nw-nowrap' },
              NW.fmtWords(Number(bookWords[String(row.id)]) || 0) + ' 字',
            ),
          ),
        );
        const detail = h(
          'div',
          { className: 'nw-journal-detail' },
          h('h4', null, String(activeNovel.title || '未命名小说')),
          h(
            'dl',
            null,
            h('dt', null, '章节'),
            h('dd', null, chapters.length + ' 章'),
            h('dt', null, '字数'),
            h('dd', null, workBusy ? '统计中…' : workCount + ' 字'),
            h('dt', null, NW.t('体裁')),
            h('dd', null, genreLabelOf(genre || recommendedGenre)),
          ),
          activeNovel.description ? h('p', { className: 'nw-hint-block' }, String(activeNovel.description)) : null,
        );
        stepBody.push(
          h('div', { className: 'nw-submit-grid' }, h('div', { className: 'nw-journal-list' }, bookButtons), detail),
        );
      }

      stepBody.push(
        NW.ui.field({
          label: '投稿范围',
          children: segControl({
            ariaLabel: '投稿范围',
            value: scope,
            onChange: (value) => setScope(String(value)),
            options: [
              { value: 'novel', label: '全书（全部章节）' },
              { value: 'chapter', label: currentChapter ? '当前章' : '当前章（无）' },
              { value: 'custom', label: '指定章节' },
            ],
          }),
        }),
      );

      if (scope === 'custom') {
        const chapterBoxes = chapters.map((row) =>
          h(
            'label',
            { key: String(row.id), className: 'nw-journal-item' },
            h('span', null, String(row.title || '未命名章节')),
            h('input', {
              type: 'checkbox',
              checked: pickedIds.indexOf(String(row.id)) >= 0,
              onChange: () => {
                const id = String(row.id);
                setPickedIds((prev) =>
                  prev.indexOf(id) >= 0 ? prev.filter((item) => item !== id) : prev.concat([id]),
                );
              },
              style: { width: '16px', height: '16px' },
            }),
          ),
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-journal-list', style: { marginTop: '8px' } },
            chapters.length === 0 ? h('div', { className: 'nw-dim' }, '这本书还没有章节') : chapterBoxes,
          ),
        );
      }

      const genreButtons = GENRE_OPTIONS.map((entry) =>
        NW.ui.btn({
          key: entry.value,
          kind: (genre || recommendedGenre) === entry.value ? 'primary' : 'default',
          onClick: () => {
            setGenre(entry.value);
            setGenreTouched(true);
          },
          children:
            entry.label +
            ((genre || recommendedGenre) === entry.value && entry.value === recommendedGenre ? ' ✦' : ''),
        }),
      );
      stepBody.push(
        NW.ui.field({
          label: NW.t('体裁'),
          hint:
            '按字数自动推荐：' +
            genreLabelOf(recommendedGenre) +
            '；期刊的收稿邮箱会按体裁与篇幅匹配，可手动改选。',
          children: h('div', { className: 'nw-genre-seg nw-seg' }, genreButtons),
        }),
      );
    }

    // ---- step 2 ---- the journal, ranked for this manuscript first.
    if (step === 2) {
      if (recos && recos.length > 0) {
        const recoButtons = recos.map((row) => {
          const entry = (row && row.journal) || {};
          const reasons = Array.isArray(row && row.reasons) ? row.reasons : [];
          const match = row && row.match && typeof row.match === 'object' ? row.match : null;
          // R26: only the first two reasons used to be shown, which hid every
          // discriminating signal behind the generic "有公开投稿邮箱（待核对）"
          // tail. Drop that note (it is true for almost every journal) and show
          // up to three reasons, so the ordering explains itself.
          const shown = reasons.filter((text) => String(text).indexOf('邮箱') < 0).slice(0, 3);
          const why = (shown.length ? shown : reasons).join('·');
          const badge = match && match.quality ? h('span', { className: 'nw-reco-fit' }, match.quality) : null;
          return h(
            'button',
            {
              key: String(entry.id),
              type: 'button',
              className: 'nw-reco-item',
              title: reasons.join('；'),
              onClick: () => {
                setSelectedId(String(entry.id));
                setManage(false);
              },
            },
            h(
              'span',
              { className: 'nw-reco-line' },
              h('span', { className: 'nw-reco-name' }, String(entry.name || '')),
              badge,
            ),
            h('span', { className: 'nw-reco-why' }, why),
          );
        });
        // Say who ranked these: a model that read the manuscript, or the rule
        // ranker because the model was unavailable. Never let the card imply a
        // judgement that did not happen.
        const byModel = !!(recoMeta && recoMeta.by === 'model');
        const headText = byModel
          ? NW.t('大模型读过开头，按契合度与水准推荐')
          : NW.t('为你推荐（按字数、体裁与题材匹配）');
        const noteText = String((recoMeta && recoMeta.note) || '');
        stepBody.push(
          h(
            'div',
            { className: 'nw-reco' },
            h(
              'div',
              { className: 'nw-reco-head' },
              NW.icon('sparkle', { size: 14 }),
              h('span', null, headText),
              recoBusy ? NW.ui.spinner() : null,
            ),
            noteText ? h('div', { className: 'nw-reco-note' }, noteText) : null,
            h('div', { className: 'nw-reco-list' }, recoButtons),
          ),
        );
      }

      let detailBody = null;
      if (manage && selected) {
        detailBody = h(
          'div',
          null,
          h('h4', null, '编辑期刊信息'),
          // R16 ⑩: 期刊水平等级 — the badge the author weighs first.
          NW.ui.field({
            label: NW.t('期刊等级'),
            hint: '国家级 / 省级 / 市级只是常见的投稿难度参考，具体以期刊官方说明为准。',
            children: NW.ui.select({
              value: editTier,
              ariaLabel: NW.t('期刊等级'),
              options: [
                { value: 'national', label: '国家级' },
                { value: 'provincial', label: '省级' },
                { value: 'municipal', label: '市级' },
                { value: 'other', label: '其他' },
              ],
              onChange: (v) => setEditTier(v),
            }),
          }),
          NW.ui.field({
            label: '默认收稿邮箱',
            hint: '不带分类条件的通用邮箱；下面登记了分体裁邮箱的，投稿时优先用那一行。',
            children: NW.ui.input({
              value: editEmail,
              placeholder: '编辑部收稿邮箱',
              onChange: (v) => setEditEmail(v),
            }),
          }),
          emailRowEditor(editEmailRows, {
            setRow: (index, patch) =>
              setEditEmailRows((prev) => prev.map((row, i) => (i === index ? Object.assign({}, row, patch) : row))),
            addRow: () => setEditEmailRows((prev) => prev.concat([{ email: '', genres: [], range: '', note: '' }])),
            removeRow: (index) => setEditEmailRows((prev) => prev.filter((row, i) => i !== index)),
            toggleGenre: (current, value) =>
              current.indexOf(value) >= 0 ? current.filter((item) => item !== value) : current.concat([value]),
          }),
          NW.ui.field({
            label: '字数区间',
            children: NW.ui.input({
              value: editRange,
              placeholder: '例如 3000–20000 字',
              onChange: (v) => setEditRange(v),
            }),
          }),
          NW.ui.field({
            label: '投稿要求（每行一条）',
            children: NW.ui.textarea({
              rows: 5,
              value: editRequirements,
              onChange: (v) => setEditRequirements(v),
              ariaLabel: '投稿要求',
            }),
          }),
          h(
            'div',
            { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap' } },
            NW.ui.btn({ kind: 'primary', onClick: saveManage, disabled: !!manageBusy, children: NW.t('保存') }),
            NW.ui.btn({ onClick: () => setManage(false), disabled: !!manageBusy, children: '取消' }),
          ),
          manageBusy ? h('div', { className: 'nw-inline', style: { marginTop: '8px' } }, NW.ui.spinner(manageBusy)) : null,
          h('p', { className: 'nw-hint-block' }, '信息会保存在本机，用于下次投稿；请以期刊官方最新征稿启事为准。'),
        );
      } else if (selected) {
        const requirementRows = (Array.isArray(selected.requirements) ? selected.requirements : []).map((line, index) =>
          h('li', { key: String(index) }, String(line)),
        );
        detailBody = h(
          'div',
          null,
          h('h4', null, String(selected.name || '')),
          h(
            'dl',
            null,
            // R16 ⑩: the tier sits first — it is the fastest read on "how hard
            // is this to get into".
            h('dt', null, NW.t('期刊等级')),
            h('dd', null, tierBadge(selected.tier)),
            h('dt', null, NW.t('体裁')),
            h('dd', null, genreCodesOf(selected).map((code) => genreLabelOf(code)).join(' / ') || '不限'),
            h('dt', null, '字数范围'),
            h('dd', null, String(selected.wordRange || '未注明')),
            h('dt', null, '本稿收稿邮箱'),
            h(
              'dd',
              null,
              suggestedTo ? suggestedTo : badge('待核对', 'warn'),
              emailNote ? h('span', { className: 'nw-attach-hint' }, emailNote) : null,
            ),
            // R10 ⑥: a journal that divides by 体裁/篇幅 has several inboxes, and
            // hiding the ones that do not match this manuscript is exactly what
            // makes the list look like "only one address exists". Show every
            // registered inbox with the matching one marked.
            variantRows.length > 0
              ? h('dt', null, NW.t('该刊登记的收稿邮箱') + '（' + String(variantRows.length) + '）')
              : null,
            variantRows.length > 0 ? h('dd', null, h('ul', { className: 'nw-variant-list' }, variantRows)) : null,
            selected.website ? h('dt', null, '官网') : null,
            selected.website
              ? h(
                  'dd',
                  null,
                  h(
                    'a',
                    { className: 'nw-link', href: String(selected.website), target: '_blank', rel: 'noreferrer noopener' },
                    String(selected.website),
                  ),
                )
              : null,
          ),
          requirementRows.length > 0
            ? h('ul', null, requirementRows)
            : h('p', { className: 'nw-hint-block' }, '该刊还没有记录投稿要求。'),
          selected.note ? h('p', { className: 'nw-hint-block' }, String(selected.note)) : null,
          h(
            'div',
            { className: 'nw-row' },
            h('span', null, '本稿'),
            h(
              'span',
              { className: 'nw-dim' },
              (activeNovel.title || '未命名') + ' · ' + workCount + ' 字 · ' + genreLabelOf(genre || recommendedGenre),
            ),
          ),
        );
      } else {
        detailBody = h('div', { className: 'nw-dim' }, '在左侧选择一家期刊，这里会显示它的投稿要求、邮箱与字数范围。');
      }

      const journalButtons = filtered.map((entry) =>
        h(
          'button',
          {
            key: String(entry.id),
            type: 'button',
            className: 'nw-journal-item',
            'data-active': String(entry.id) === String(selectedId) ? '1' : '0',
            onClick: () => {
              setSelectedId(String(entry.id));
              setManage(false);
            },
          },
          h('span', { className: 'nw-journal-name' }, String(entry.name || '未命名期刊')),
          // R16 ⑩: the tier is the first thing an author weighs a journal by.
          h('span', { className: 'nw-journal-tags' }, tierBadge(entry.tier)),
          String(entry.email || '').trim() ? null : badge('待核对', 'warn'),
        ),
      );

      const searchRow = h(
        'div',
        { style: { display: 'flex', gap: '6px', marginBottom: '8px' } },
        NW.ui.input({
          value: query,
          placeholder: '搜索期刊名或别名',
          onChange: (v) => setQuery(v),
          ariaLabel: '搜索期刊',
        }),
        NW.ui.btn({ onClick: startManage, disabled: !selected, children: '管理' }),
      );

      const journalListBox =
        journals == null
          ? h('div', { className: 'nw-inline' }, NW.ui.spinner('读取期刊清单…'))
          : h(
              'div',
              { className: 'nw-journal-list' },
              filtered.length === 0 ? h('div', { className: 'nw-dim' }, '没有匹配的期刊') : journalButtons,
            );

      stepBody.push(
        h(
          'div',
          { className: 'nw-submit-grid' },
          h('div', null, searchRow, journalsError ? h('div', { className: 'nw-lock-error', role: 'alert' }, journalsError) : null, journalListBox),
          h('div', { className: 'nw-journal-detail' }, detailBody),
        ),
      );
    }

    // ---- step 3 ---- the whole mail, fully editable. This is the last screen
    // before sending, so nothing hides behind another confirmation: what you
    // read here is exactly what goes out.
    if (step >= 3) {
      if (sent) {
        const historyRows = (records || []).slice(0, 8).map((row) =>
          h(
            'div',
            { key: String(row.id || row.at), className: 'nw-row' },
            h('span', { className: 'nw-nowrap' }, String(row.journalName || '未注明期刊')),
            h('span', { className: 'nw-dim' }, NW.fmtDate(row.at) + ' · ' + String(row.status || '')),
          ),
        );
        stepBody.push(h('h4', null, '投稿邮件已发送'));
        stepBody.push(
          h('p', { className: 'nw-hint-block' }, '收件人：' + String(sent.to || '') + '　·　发送时间：' + NW.fmtDate(sent.at)),
        );
        stepBody.push(
          historyRows.length > 0
            ? h('div', { className: 'nw-version-list' }, historyRows)
            : h('p', { className: 'nw-hint-block' }, '历史投稿记录会保存在本机，最多 50 条。'),
        );
        if (sendError) stepBody.push(h('div', { className: 'nw-lock-error', role: 'alert' }, sendError));
      } else if (preparing || (!prepared && !prepareError)) {
        // R32 ①: nothing of the letter is shown until the letter exists. A
        // preview that grows in field by field reads as "it broke".
        const stages = ['读取稿件与章节', '分析期刊偏好与征稿要求', '按体裁匹配收稿邮箱', '撰写投稿邮件', '排版并生成附件'];
        const reached = Math.min(stages.length, prepareTick);
        stepBody.push(
          h(
            'div',
            { className: 'nw-prep', role: 'status', 'aria-live': 'polite' },
            h(
              'div',
              { className: 'nw-prep-head' },
              h('span', { className: 'nw-prep-orb', 'aria-hidden': 'true' }),
              h(
                'span',
                { className: 'nw-prep-title' },
                selected ? '正在为《' + String(selected.name || '') + '》准备投稿邮件' : '正在准备投稿邮件',
              ),
            ),
            h(
              'ol',
              { className: 'nw-prep-steps' },
              stages.map((label, index) =>
                h(
                  'li',
                  {
                    key: 'stage-' + String(index),
                    className: 'nw-prep-step',
                    'data-on': index < reached ? '1' : '0',
                    'data-now': index === reached && preparing ? '1' : '0',
                  },
                  h('span', { className: 'nw-prep-dot', 'aria-hidden': 'true' }),
                  h('span', null, label),
                ),
              ),
            ),
            h('div', { className: 'nw-prep-bar', 'aria-hidden': 'true' }, h('i', null)),
            h(
              'div',
              { className: 'nw-prep-hint' },
              '模型正在通读全文并比对这家刊的征稿要求，通常十几秒。完成后直接进入预览，届时每个字段都能改。',
            ),
          ),
        );
      } else if (prepareError) {
        // R32 1: a failed prepare must not fall through to an empty preview.
        stepBody.push(
          h(
            'div',
            { className: 'nw-lock-error', role: 'alert' },
            prepareError,
            h(
              'div',
              { className: 'nw-inline', style: { marginTop: '8px' } },
              NW.ui.btn({ onClick: runPrepare, disabled: preparing, children: '重试' }),
            ),
          ),
        );
      } else {
        if (!smtp.loading && !smtp.configured) {
          stepBody.push(
            h(
              'div',
              { className: 'nw-lock-error', role: 'alert' },
              h('div', null, '还没有配置投稿邮箱，暂时不能直接发送。'),
              h(
                'div',
                { className: 'nw-inline', style: { marginTop: '8px' } },
                NW.ui.btn({
                  kind: 'primary',
                  onClick: () => openSibling(p, 'settings', { section: 'submit' }),
                  children: '去配置邮箱',
                }),
              ),
            ),
          );
        }
        // 期刊 + 收件人 — both editable: the automation is a suggestion and the
        // author is the one signing the letter.
        const journalOptions = [{ value: '', label: '（未选择）' }].concat(
          list.map((entry) => ({ value: String(entry.id), label: String(entry.name || '未命名期刊') })),
        );
        const toBox = h(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          NW.ui.input({
            value: toDraft,
            placeholder: '编辑部收稿邮箱',
            ariaLabel: '收件人',
            onChange: (v) => setToDraft(v),
          }),
          suggestedTo && suggestedTo !== String(toDraft || '').trim()
            ? NW.ui.btn({ onClick: () => setToDraft(suggestedTo), children: '用推荐' })
            : null,
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-grid2' },
            NW.ui.field({
              label: '投稿期刊',
              children: NW.ui.select({
                value: String(selectedId || ''),
                ariaLabel: '投稿期刊',
                options: journalOptions,
                onChange: (v) => {
                  setSelectedId(String(v || ''));
                  setManage(false);
                },
              }),
            }),
            NW.ui.field({
              label: '收件人',
              hint: [toWhy, emailNote || '可以直接改成编辑部的其他邮箱。'].filter(Boolean).join(' '),
              children: toBox,
            }),
          ),
        );

        const bodyHint =
          '共 ' +
          body.length +
          ' 字符' +
          (prepared && prepared.pasteInBody ? ' · 已包含稿件全文（按该刊要求粘贴在正文里）' : ' · 只含投稿信，小说全文走附件') +
          '。可以直接修改，发出的就是这里的文字。';

        stepBody.push(
          NW.ui.field({
            label: NW.t('邮件主题'),
            // R6 ⑤: if the journal spells out a subject format, surface that line
            // right under the subject box so it can be checked at a glance.
            hint: subjectRuleOf(prepared),
            children: NW.ui.input({ value: subject, onChange: (v) => setSubject(v), ariaLabel: '邮件主题' }),
          }),
        );
        stepBody.push(
          NW.ui.field({
            label: NW.t('邮件正文'),
            hint: bodyHint,
            children: NW.ui.textarea({ rows: 18, value: body, onChange: (v) => setBody(v), ariaLabel: '邮件正文' }),
          }),
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap' } },
            NW.ui.btn({ onClick: () => setFullBody(true), children: '全文查看' }),
            NW.ui.btn({ onClick: runPrepare, disabled: preparing, children: '按期刊要求重新生成' }),
            NW.ui.btn({ onClick: () => setBody(applySignature(body, form.signature)), children: '补上署名' }),
          ),
        );

        // 附件 — count, filename and bytes are all editable here.
        const attachBoxes = (attachRows || []).map((row, index) =>
          h(
            'div',
            { key: 'attach-' + String(index), style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            NW.ui.input({
              value: row.filename,
              ariaLabel: '附件名',
              onChange: (v) =>
                setAttachRows((prev) =>
                  prev.map((item, i) => (i === index ? Object.assign({}, item, { filename: v }) : item)),
                ),
            }),
            h('button', {
              type: 'button',
              className: 'nw-attach-open',
              disabled: !!attachmentBusy,
              onClick: () => openAttachment(row),
              children: attachmentBusy === row.filename ? '读取…' : '预览',
            }),
            h('button', {
              type: 'button',
              className: 'nw-attach-open',
              onClick: () => downloadAttachment(row),
              children: '下载',
            }),
            h('button', {
              type: 'button',
              className: 'nw-attach-open',
              onClick: () => setAttachRows((prev) => prev.filter((item, i) => i !== index)),
              children: '移除',
            }),
          ),
        );
        const attachEmpty =
          prepared && Array.isArray(prepared.attachFormats) && prepared.attachFormats.length === 0
            ? '该刊不要求附件，全文已粘贴在正文'
            : '暂无附件';
        const attachRule = prepared && prepared.attachmentCount
          ? '该刊要求 ' +
            prepared.attachmentCount +
            ' 个附件' +
            (prepared.attachmentNaming && prepared.attachmentNaming.sentence
              ? '，命名：' + prepared.attachmentNaming.sentence
              : '')
          : '附件格式与数量已按征稿要求生成，可改名或增删。';
        stepBody.push(
          h(
            'div',
            { className: 'nw-field' },
            h('label', null, '附件'),
            attachBoxes.length > 0
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, attachBoxes)
              : h('div', { className: 'nw-dim' }, attachEmpty),
            h(
              'div',
              { className: 'nw-inline', style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
              NW.ui.btn({ onClick: addAttachmentFiles, disabled: !!attachBusy, children: attachBusy || '添加本地文件…' }),
              attachBoxes.length ? NW.ui.btn({ onClick: () => setAttachRows([]), children: '清空附件' }) : null,
            ),
            h('span', { className: 'nw-hint' }, attachRule),
          ),
        );

        // R7 ③: show the rule that shaped this mail — attachments and body shape
        // are derived from 征稿要求, so say which rule was applied.
        if (prepared && Array.isArray(prepared.ruleNotes) && prepared.ruleNotes.length) {
          stepBody.push(
            h(
              'div',
              { className: 'nw-row' },
              h('span', null, '照刊要求'),
              h('span', { className: 'nw-attach-hint' }, prepared.ruleNotes.join('；')),
            ),
          );
        }

        // 署名信息 — part of the mail, so editable on the same screen.
        stepBody.push(
          h(
            'div',
            { className: 'nw-grid2', style: { marginTop: '12px' } },
            NW.ui.field({
              label: '笔名',
              children: NW.ui.input({
                value: form.penName,
                placeholder: '署名用的作者名',
                onChange: (v) => setForm((prev) => Object.assign({}, prev, { penName: v })),
              }),
            }),
            NW.ui.field({
              label: '回信邮箱',
              children: NW.ui.input({
                value: form.email,
                placeholder: '编辑回复用',
                onChange: (v) => setForm((prev) => Object.assign({}, prev, { email: v })),
              }),
            }),
          ),
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-grid2' },
            NW.ui.field({
              label: '联系方式',
              children: NW.ui.input({
                value: form.contact,
                placeholder: '手机 / 微信',
                onChange: (v) => setForm((prev) => Object.assign({}, prev, { contact: v })),
              }),
            }),
            NW.ui.field({
              label: '文末署名',
              children: NW.ui.input({
                value: form.signature,
                placeholder: '稿件末尾的署名行',
                onChange: (v) => setForm((prev) => Object.assign({}, prev, { signature: v })),
              }),
            }),
          ),
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-row' },
            h('span', null, '字数'),
            h(
              'span',
              { className: 'nw-dim' },
              (prepared && prepared.wordCount ? prepared.wordCount : workCount) + ' 字',
            ),
          ),
        );
        stepBody.push(
          h(
            'div',
            { className: 'nw-row' },
            h('span', null, NW.t('体裁')),
            h('span', { className: 'nw-dim' }, genreLabelOf((prepared && prepared.genre) || genre || recommendedGenre)),
          ),
        );

        if (prepared && Array.isArray(prepared.changes) && prepared.changes.length) {
          const changeRows = prepared.changes.map((change, index) =>
            h(
              'li',
              { key: String(index) },
              h('span', null, String(changeKindLabel(change && change.kind))),
              change && change.before ? h('del', null, String(change.before)) : null,
              change && change.after ? h('ins', null, String(change.after)) : null,
            ),
          );
          stepBody.push(
            h(
              'div',
              { style: { marginTop: '10px' } },
              h('div', { className: 'nw-dim' }, '按期刊要求做的调整'),
              h('ul', { className: 'nw-submit-changes' }, changeRows),
            ),
          );
        }

        if (sendError) stepBody.push(h('div', { className: 'nw-lock-error', role: 'alert' }, sendError));
        if (selected && selected.paperOnly) {
          stepBody.push(
            h(
              'div',
              { className: 'nw-lock-error', role: 'alert' },
              '这家期刊以纸质邮寄为主，直接发邮件可能不被受理。建议改为本地导出后邮寄，或先电话 / 邮件确认收稿方式。',
            ),
          );
        }
        if (smtp.configured && smtp.user) {
          stepBody.push(h('p', { className: 'nw-hint-block' }, '将从 ' + smtp.user + ' 发出。'));
        }
        stepBody.push(
          h(
            'p',
            { className: 'nw-hint-block' },
            '主题、正文、收件人、附件都可以直接改，确认无误后点右下角「确认投稿」。发送后会写入本机的投稿记录，可在「投稿管理」里标记处理状态。',
          ),
        );

      }
    }

    // Reader views (attachment text, whole letter) replace the step body rather
    // than stacking another modal on top: a second ModalShell would also own the
    // window-level Escape handler, so one Esc would close both layers at once.
    let reader = null;

    if (attachmentPreview) {
      const previewMeta =
        attachmentPreview.chars +
        ' 字' +
        (attachmentPreview.chapters > 1 ? ' ・ ' + attachmentPreview.chapters + ' 章' : '') +
        (attachmentPreview.truncated ? ' ・ 仅显示前 12 万字' : '');
      reader = h(
        'div',
        null,
        h(
          'div',
          { className: 'nw-row', style: { marginBottom: '8px' } },
          h('span', null, '附件预览 · ' + attachmentPreview.filename),
          NW.ui.btn({ onClick: () => setAttachmentPreview(null), children: '返回' }),
        ),
        h('div', { className: 'nw-dim', style: { marginBottom: '8px' } }, previewMeta),
        h('pre', { className: 'nw-attach-text' }, attachmentPreview.text || '（该附件没有可显示的文本内容）'),
      );
    } else if (fullBody) {
      reader = h(
        'div',
        null,
        h(
          'div',
          { className: 'nw-row', style: { marginBottom: '8px' } },
          h('span', null, '邮件全文'),
          NW.ui.btn({ onClick: () => setFullBody(false), children: '返回' }),
        ),
        h('div', { className: 'nw-dim', style: { marginBottom: '8px' } }, body.length + ' 字符 · 完整内容，未截断'),
        h('pre', { className: 'nw-attach-text' }, body || '（正文为空）'),
      );
    }

    const footer = [];
    if (sent) {
      footer.push(
        NW.ui.btn({
          kind: 'primary',
          onClick: () => {
            if (typeof p.onSubmitSent === 'function') p.onSubmitSent();
            else if (typeof p.onClose === 'function') p.onClose();
          },
          children: NW.t('完成'),
        }),
      );
    } else if (preparing || (!prepared && !prepareError && step >= 3)) {
      // R32 ①: step 3 shows the progress panel, so the only honest action is 取消.
      footer.push(closeBtn(p));
    } else {
      footer.push(closeBtn(p));
      if (step > 1) footer.push(NW.ui.btn({ onClick: back, disabled: sending, children: '上一步' }));
      if (step < 3) {
        footer.push(NW.ui.btn({ kind: 'primary', onClick: next, disabled: !canNext, children: '下一步' }));
      } else {
        footer.push(
          NW.ui.btn({
            kind: 'primary',
            onClick: doSend,
            disabled: sending || preparing || !smtp.configured || !toAddress,
            children: sending ? '发送中…' : '确认投稿',
          }),
        );
      }
    }

    return modal(
      '投稿助手',
      h(
        'div',
        null,
        reader
          ? reader
          : h(
              'div',
              null,
              segControl({
                ariaLabel: '投稿步骤',
                value: step,
                onChange: (value) => {
                  const target = Number(value) || 1;
                  if (target < step) setStep(target);
                },
                options: steps,
              }),
              h('div', { style: { marginTop: '12px' } }, stepBody),
            ),
      ),
      h('div', { style: { display: 'flex', gap: '8px' } }, reader ? [closeBtn(p)] : footer),
      '820px',
      p.onClose,
    );
  };

  /** Append the signature line once, so「补上署名」cannot double it. */
  function applySignature(body, signature) {
    const text = String(body == null ? '' : body);
    const line = String(signature == null ? '' : signature).trim();
    if (!line) return text;
    if (text.indexOf(line) >= 0) return text;
    return text.replace(/\s+$/, '') + '\n\n' + line;
  }

  /** Read a picked File into bare base64 (no `data:` prefix), for `submit.send`. */
  function fileToBase64(file) {
    return new Promise((resolve) => {
      if (!file) {
        resolve('');
        return;
      }
      try {
        const reader = new FileReader();
        reader.onerror = () => resolve('');
        reader.onload = () => {
          const result = String(reader.result || '');
          const at = result.indexOf(',');
          resolve(at >= 0 ? result.slice(at + 1) : '');
        };
        reader.readAsDataURL(file);
      } catch (err) {
        resolve('');
      }
    });
  }

  /** Journal entries store genres as a boolean map; the UI shows the codes. */
  function genreCodesOf(entry) {
    const map = (entry && entry.genres) || {};
    const codes = ['weixiaoshuo', 'duanpian', 'zhongpian', 'changpian'];
    return codes.filter((code) => map[code] === true);
  }

  /** Plain-language label for one `submit.prepare` change entry. */
  function changeKindLabel(kind) {
    const code = String(kind || '');
    if (code === 'chapter-title') return '章节标题';
    if (code === 'indent') return '首行缩进';
    if (code === 'punct') return '标点';
    if (code === 'blank') return '空行';
    return '格式';
  }

  // ============================================================== Pair =====
  /**
   * 手机配对—the two values a phone needs, and the devices already paired.
   *
   * R38: this is a panel, not a dialog. It used to be reachable only through a
   * 「显示配对地址和配对码…」 button that closed the settings window and opened a
   * second one, so reading a code and then typing it on the phone meant juggling
   * two windows — and on a small laptop the second window covered the first.
   * The settings section renders this in place now; `NW.dialogs.Pair` is a thin
   * wrapper kept for the header entry point, so both roads share one
   * implementation instead of drifting apart.
   */
  function PairPanel(props) {
    const p = props || {};
    const [info, setInfo] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [peers, setPeers] = useState(null);
    const [left, setLeft] = useState(0);

    const refreshPeers = () => {
      NW.io.pair
        .peers()
        .then((data) => setPeers(Array.isArray(data && data.peers) ? data.peers : []))
        .catch(() => setPeers([]));
    };

    useEffect(() => {
      refreshPeers();
      return undefined;
    }, []);

    // R38: this panel *is* the address and the code, so it must not open empty
    // and wait for someone to find 「生成配对码」 — that was the complaint. Ask for
    // one on mount, and reuse a still-valid offer when there is one: opening
    // settings again mid-pairing must not invalidate the code being typed on the
    // phone.
    const bootRef = useRef(false);
    useEffect(() => {
      if (bootRef.current) return undefined;
      bootRef.current = true;
      let alive = true;
      const bootBusy = NW.t('正在生成配对信息…');
      setBusy(bootBusy);
      NW.io.pair
        .status()
        .then((data) => {
          if (!alive) return null;
          if (data && data.active && data.token) {
            setInfo(data);
            return null;
          }
          return NW.io.pair.start().then((fresh) => {
            if (alive) setInfo(fresh);
          });
        })
        .catch((err) => {
          if (alive) setError(errText(err, '生成配对码失败'));
        })
        .then(() => {
          if (alive) setBusy((current) => (current === bootBusy ? '' : current));
        });
      return () => {
        alive = false;
      };
    }, []);

    // Countdown, not a progress bar: the only useful fact about a pairing code is
    // how long it is still good for.
    useEffect(() => {
      if (!info || !info.expiresAt) return undefined;
      const tick = () => setLeft(Math.max(0, Math.round((Number(info.expiresAt) - Date.now()) / 1000)));
      tick();
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    }, [info]);

    // Poll for "did the phone accept yet" while the code is on screen — the
    // desktop cannot know otherwise, and without this the panel would still say
    // 「等待扫码」 after a successful pair.
    // The countdown above re-renders once a second, so this effect must not
    // depend on `left`: doing so tore down and rebuilt the interval before its
    // first tick ever ran and the desktop never noticed a successful pair.
    const pairedRef = useRef(false);
    useEffect(() => {
      if (!info || !info.expiresAt) return undefined;
      pairedRef.current = false;
      const timer = setInterval(() => {
        if (pairedRef.current) return;
        if (Number(info.expiresAt) <= Date.now()) return;
        NW.io.pair
          .status()
          .then((data) => {
            if (!data || data.active !== false || pairedRef.current) return;
            pairedRef.current = true;
            // The offer is consumed by the accept, so the code on screen is dead
            // text now. Drop it rather than leave a countdown running next to a
            // code that would only answer 「过期」 if typed.
            setInfo(null);
            refreshPeers();
            p.onToast && p.onToast('手机已配对', 'ok');
          })
          .catch(() => {});
      }, 2500);
      return () => clearInterval(timer);
    }, [info]);

    function showCode() {
      setError('');
      setBusy('正在生成配对码…');
      NW.io.pair
        .start()
        .then((data) => {
          setInfo(data);
          refreshPeers();
        })
        .catch((err) => setError(errText(err, '生成配对码失败')))
        .then(() => setBusy(''));
    }

    function unpair(peer) {
      NW.ui
        .confirm(`解除与「${peer.name}」的配对？这台设备之后需要重新扫码才能同步。`, {
          title: '解除配对',
          danger: true,
          okText: '解除',
        })
        .then((yes) => {
          if (!yes) return null;
          return NW.io.pair.remove(peer.id).then(() => {
            refreshPeers();
            p.onToast && p.onToast('已解除配对', 'ok');
          });
        })
        .catch((err) => setError(errText(err, '解除配对失败')));
    }

    // Copy as two lines: the phone form has one field per line. Pasting the whole
    // thing into the address field also works — the app splits a `nw1:` payload.
    function copyManual() {
      const text = `${info.address || ''}:${info.port || '?'}\n${info.token || ''}`;
      const toast = (message, kind) => p.onToast && p.onToast(message, kind);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => toast(NW.t('已复制地址和配对码'), 'ok'),
            () => toast(NW.t('复制失败，请手动选中这两行'), 'warn'),
          );
          return;
        }
      } catch (error) {
        // Clipboard API missing or blocked (no secure context) — fall through.
      }
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(area);
      toast(copied ? NW.t('已复制地址和配对码') : NW.t('复制失败，请手动选中这两行'), copied ? 'ok' : 'warn');
    }

    return h('div', { className: 'nw-pair nw-pair-inline' }, [
      h(
        'p',
        { className: 'nw-hint-block' },
        NW.t('在手机上打开「精神空间」→「配对」，把下面的「电脑地址」和「配对码」填进去；也可以「改成扫码」对准二维码。配对一次即可，之后在同一个 Wi-Fi 下会自动同步。'),
      ),
      error ? h('div', { className: 'nw-lock-error', role: 'alert' }, error) : null,
      info
        ? h('div', { className: 'nw-pair-stack' }, [
            // Typing comes first: the address and code are what the phone form
            // actually asks for, and a code that is printed can always be copied.
            info.token
              ? h('div', { className: 'nw-pair-manual' }, [
                  h('div', { className: 'nw-pair-manual-head' }, NW.t('在手机「配对」里填这两行')),
                  h('div', { className: 'nw-pair-manual-row' }, [
                    h('span', { className: 'nw-pair-manual-key' }, NW.t('电脑地址')),
                    h('code', { className: 'nw-pair-manual-value' }, `${info.address || '未知'}:${info.port || '?'}`),
                  ]),
                  h('div', { className: 'nw-pair-manual-row' }, [
                    h('span', { className: 'nw-pair-manual-key' }, NW.t('配对码')),
                    h('code', { className: 'nw-pair-manual-value' }, String(info.token)),
                  ]),
                ])
              : null,
            h('div', { className: 'nw-pair-box' }, [
              h('div', { className: 'nw-pair-code', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: String(info.svg || '') } }),
              h('div', { className: 'nw-pair-meta' }, [
                h('div', { className: 'nw-pair-addr' }, NW.t('电脑地址：{0}:{1}', info.address || '未知', info.port || '?')),
                Array.isArray(info.addresses) && info.addresses.length > 1
                  ? h('div', { className: 'nw-hint-block' }, NW.t('其他可能地址：{0}', info.addresses.slice(1).join('、')))
                  : null,
                h('div', { className: 'nw-pair-timer' }, left > 0 ? NW.t('配对码 {0} 秒后失效', left) : NW.t('配对码已失效，请重新生成')),
                h('div', { className: 'nw-hint-block' }, NW.t('也可以让手机「改成扫码」对准这个二维码')),
              ]),
            ]),
          ])
        : h('div', { className: 'nw-pair-empty' }, busy ? NW.ui.spinner('正在生成配对信息…') : '点下面的「生成配对码」。'),
      h(
        'div',
        { className: 'nw-pair-actions' },
        NW.ui.btn({ kind: 'primary', onClick: showCode, disabled: !!busy, children: info ? NW.t('重新生成') : NW.t('生成配对码') }),
        info && info.token ? NW.ui.btn({ kind: 'ghost', onClick: copyManual, children: NW.t('复制这两行') }) : null,
      ),
      h('h3', { className: 'nw-pair-subhead' }, NW.t('已配对设备')),
      peers === null
        ? NW.ui.spinner(NW.t('正在读取…'))
        : !peers.length
          ? h('p', { className: 'nw-hint-block' }, NW.t('还没有配对任何设备。'))
          : h(
              'ul',
              { className: 'nw-pair-peers' },
              peers.map((peer) =>
                h(
                  'li',
                  { key: peer.id, className: 'nw-pair-peer' },
                  h('span', { className: 'nw-pair-peername' }, peer.name || NW.t('未命名设备')),
                  h('span', { className: 'nw-hint-block' }, peer.lastSyncAt ? NW.t('上次同步 {0}', NW.fmtDate(peer.lastSyncAt)) : NW.t('还没有同步过')),
                  NW.ui.btn({ kind: 'ghost', onClick: () => unpair(peer), children: NW.t('解除配对') }),
                ),
              ),
            ),
    ]);
  }

  NW.dialogs.Pair = function Pair(props) {
    const p = props || {};
    return modal(
      '手机配对',
      h(PairPanel, { onToast: typeof p.onToast === 'function' ? p.onToast : null }),
      [closeBtn(p)],
      '560px',
      p.onClose,
    );
  };

  // ============================================================ Versions ====
  NW.dialogs.Versions = function Versions(props) {
    const p = props || {};
    const chapterId = (p.dialog && p.dialog.chapterId) || (p.chapter && p.chapter.id);
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [preview, setPreview] = useState(null);

    useEffect(() => {
      let alive = true;
      if (!chapterId) {
        setRows([]);
        return undefined;
      }
      NW.db
        .listVersions(chapterId)
        .then((list) => {
          if (alive) setRows(list || []);
        })
        .catch((err) => {
          if (alive) setError(errText(err, '读取版本失败'));
        });
      return () => {
        alive = false;
      };
    }, [chapterId]);

    const takeSnapshot = async () => {
      setBusy('保存快照…');
      try {
        let saved = true;
        if (typeof p.onSnapshotVersion === 'function') saved = await p.onSnapshotVersion(true);
        const list = await NW.db.listVersions(chapterId);
        setRows(list || []);
        if (typeof p.onToast === 'function') {
          if (saved === false) p.onToast('当前章节没有可保存的正文，未创建快照', 'warn');
          else p.onToast('已创建版本快照', 'ok');
        }
      } catch (err) {
        setError(errText(err, '创建快照失败'));
      } finally {
        setBusy('');
      }
    };

    const restore = async (row) => {
      const ok = await NW.ui.confirm('恢复到该版本？当前内容会先存为一个新版本。', { title: NW.t('恢复') });
      if (!ok) return;
      setBusy('恢复中…');
      try {
        // Forced: the throttle exists for browsing, not for overwriting text.
        if (typeof p.onSnapshotVersion === 'function') await p.onSnapshotVersion(true);
        const api = p.editorApi && p.editorApi.current;
        if (api && typeof api.setContent === 'function') api.setContent(row.content || '');
        if (typeof p.onRefreshData === 'function') await p.onRefreshData();
        if (typeof p.onToast === 'function') p.onToast('已恢复历史版本', 'ok');
        if (typeof p.onClose === 'function') p.onClose();
      } catch (err) {
        setError(errText(err, '恢复失败'));
      } finally {
        setBusy('');
      }
    };

    const body = [];
    if (rows == null) body.push(NW.ui.spinner('读取版本…'));
    else if (rows.length === 0) body.push(NW.ui.empty('还没有历史版本。每次切换章节或手动快照都会记录。'));
    else {
      body.push(
        h(
          'div',
          { className: 'nw-version-list', role: 'list' },
          rows.map((row) =>
            h(
              'div',
              { key: row.id, className: 'nw-row', role: 'listitem' },
              h(
                'span',
                { style: { display: 'inline-flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
                h('span', null, NW.fmtDate(row.createdAt)),
                h('span', { className: 'nw-dim' }, NW.fmtWords(row.words || (row.content || '').length) + ' 字'),
              ),
              h(
                'span',
                { style: { display: 'inline-flex', gap: '6px' } },
                NW.ui.btn({ onClick: () => setPreview(row), children: NW.t('预览') }),
                NW.ui.btn({ kind: 'primary', onClick: () => restore(row), disabled: !!busy, children: NW.t('恢复') }),
              ),
            ),
          ),
        ),
      );
    }
    if (preview) {
      body.push(
        h(
          'div',
          { className: 'nw-preview-box' },
          h('div', { className: 'nw-inline', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('strong', null, '版本预览'), NW.ui.btn({ kind: 'ghost', onClick: () => setPreview(null), children: NW.t('关闭') })),
          h('pre', { className: 'nw-preview-text' }, String(preview.content || '').slice(0, 6000)),
        ),
      );
    }
    if (busy) body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner(busy)));
    if (error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, error));

    return modal(
      NW.t('版本历史'),
      h('div', null, body),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        NW.ui.btn({ onClick: takeSnapshot, disabled: !!busy || !chapterId, children: '立即快照' }),
        closeBtn(p),
      ),
      '620px',
      p.onClose,
    );
  };

  // =============================================================== Trash ====
  /**
   * 读信 (R12 ④) — the inbox rows were plain text and could not be opened.
   *
   * The list route only carries headers plus a 160-character snippet, so this
   * dialog asks the host for the full body on mount. Two states matter:
   * `loading` while the IMAP round trip runs (seconds, not milliseconds), and
   * the failure state, which must show *why* — "读不到" alone leaves the writer
   * unable to tell a network problem from an empty mailbox.
   */
  NW.dialogs.Mail = function Mail(props) {
    const p = props || {};
    const seed = (p.dialog && p.dialog.message) || p.message || {};
    const uid = Number((p.dialog && p.dialog.uid) || seed.uid || 0);
    const [state, setState] = useState({ loading: true, message: null, error: '', hint: '' });

    useEffect(() => {
      let alive = true;
      if (!uid) {
        setState({ loading: false, message: null, error: '这封邮件没有编号，无法读取', hint: '' });
        return undefined;
      }
      NW.io.inbox
        .read(uid)
        .then((data) => {
          if (!alive) return;
          const message = data && data.message ? data.message : null;
          setState({
            loading: false,
            message: message,
            error: String((data && data.error) || (message ? '' : '服务器没有返回正文')),
            hint: String((data && data.hint) || ''),
          });
          // R14 ②: the host marks the mail \Seen while fetching it, so the home
          // screen's 未读 badge is stale until it re-reads the mailbox. Refresh
          // only on success — a failed read must not look like a status change.
          if (message && typeof p.onMailRead === 'function') p.onMailRead(message);
        })
        .catch((err) => {
          if (!alive) return;
          setState({ loading: false, message: null, error: errText(err, '读取邮件失败'), hint: '' });
        });
      return () => {
        alive = false;
      };
    }, [uid]);

    // The headers are already in the list payload, so show them while the body
    // is still being fetched — the dialog never opens empty.
    const header = state.message || seed;
    const subject = String(header.subject || '（无主题）');
    const from = String(header.from || header.address || '未知发件人');
    const date = String(header.date || '');

    let body;
    if (state.loading) {
      body = h(
        'div',
        { className: 'nw-mail-loading' },
        NW.ui.spinner(),
        h('span', null, NW.t('正在从服务器读取这封邮件…')),
      );
    } else if (state.error) {
      body = h(
        'div',
        { className: 'nw-mail-loading' },
        h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, state.error),
        state.hint ? h('span', { className: 'nw-hint-block' }, state.hint) : null,
        NW.ui.btn({
          kind: 'primary',
          onClick: () => {
            setState({ loading: true, message: null, error: '', hint: '' });
            NW.io.inbox
              .read(uid)
              .then((data) => {
                const message = data && data.message ? data.message : null;
                setState({
                  loading: false,
                  message: message,
                  error: String((data && data.error) || (message ? '' : '服务器没有返回正文')),
                  hint: String((data && data.hint) || ''),
                });
                if (message && typeof p.onMailRead === 'function') p.onMailRead(message);
              })
              .catch((err) => setState({ loading: false, message: null, error: errText(err, '读取邮件失败'), hint: '' }));
          },
          children: NW.t('重试'),
        }),
      );
    } else {
      body = h('pre', { className: 'nw-mail-body' }, String(state.message.text || '（这封邮件没有可显示的正文）'));
    }

    const meta = h(
      'div',
      { className: 'nw-mail-meta' },
      h('span', { className: 'nw-mail-subject' }, subject),
      h('span', { className: 'nw-mail-from' }, from),
      date ? h('span', { className: 'nw-mail-date' }, date) : null,
    );

    return modal(
      NW.t('邮件'),
      h('div', { className: 'nw-mail' }, meta, body),
      [
        closeBtn(p),
        h('span', { style: { flex: '1 1 auto' } }),
        NW.ui.btn({
          kind: 'primary',
          // R17 ②: `onReply` is provided by DialogHost and opens the submit
          // wizard with this mail's journal pre-selected. Disable instead of
          // silently doing nothing when a host mounts the reader without it.
          disabled: typeof p.onReply !== 'function',
          title: NW.t('去投稿'),
          onClick: () => {
            if (typeof p.onReply === 'function') p.onReply(header);
          },
          children: NW.t('去投稿'),
        }),
      ],
      '760px',
      p.onClose,
    );
  };

  NW.dialogs.Trash = function Trash(props) {
    const p = props || {};
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
      try {
        const list = await NW.db.listTrash();
        setRows(list || []);
      } catch (err) {
        setError(errText(err, '读取回收站失败'));
      }
    }, []);

    useEffect(() => {
      load();
    }, [load]);

    const restore = async (row) => {
      setBusy('恢复中…');
      try {
        await NW.db.restoreTrash(row.id);
        await load();
        if (typeof p.onRefreshData === 'function') await p.onRefreshData();
        if (typeof p.onToast === 'function') p.onToast('已恢复', 'ok');
      } catch (err) {
        setError(errText(err, '恢复失败'));
      } finally {
        setBusy('');
      }
    };

    const empty = async () => {
      const ok = await NW.ui.confirm('清空回收站？此操作不可撤销。', { danger: true, title: NW.t('清空回收站') });
      if (!ok) return;
      setBusy('清理中…');
      try {
        await NW.db.emptyTrash();
        await load();
        if (typeof p.onToast === 'function') p.onToast('回收站已清空', 'ok');
      } catch (err) {
        setError(errText(err, '清空失败'));
      } finally {
        setBusy('');
      }
    };

    const body = [];
    if (rows == null) body.push(NW.ui.spinner('读取回收站…'));
    else if (rows.length === 0) body.push(NW.ui.empty('回收站是空的。'));
    else {
      body.push(
        h(
          'div',
          { role: 'list' },
          rows.map((row) =>
            h(
              'div',
              { key: row.id, className: 'nw-row', role: 'listitem' },
              h(
                'span',
                { style: { display: 'inline-flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
                h('span', { className: 'nw-nowrap' }, (row.kind === 'novel' ? '《' + (row.title || '') + '》' : row.title || '') || '未命名'),
                h('span', { className: 'nw-dim' }, NW.fmtDate(row.deletedAt) + ' 删除'),
              ),
              NW.ui.btn({ onClick: () => restore(row), disabled: !!busy, children: NW.t('恢复') }),
            ),
          ),
        ),
      );
    }
    if (error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, error));

    return modal(
      NW.t('回收站'),
      h('div', null, body, busy ? h('div', { className: 'nw-inline' }, NW.ui.spinner(busy)) : null),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        NW.ui.btn({ kind: 'danger', onClick: empty, disabled: !!busy || !rows || rows.length === 0, children: NW.t('清空回收站') }),
        closeBtn(p),
      ),
      '520px',
      p.onClose,
    );
  };

  // ====================================================== SubmitManager =====
  /**
   * 投稿管理 — the bookkeeping side of submission, which used to be invisible:
   * the mail went out and nothing recorded where it went or what came back.
   *
   * One row per submission (newest first) with 小说名 / 期刊 / 日期 / 距今 /
   * 状态徽章 / 手动标记 / 重新投稿. The status is local-only and never leaves the
   * machine; `submit.update` rewrites `submissions.json` atomically.
   */
  /**
   * Statuses the author can pick. R34: `overdue` is deliberately absent — it is
   * derived from the journal's reply window, so offering it as a choice would
   * let the UI claim something the mailbox has not said. It still needs a label,
   * which `SUBMIT_STATUS_LABELS` carries.
   */
  const SUBMIT_STATUS_OPTIONS = [
    { value: 'sent', label: '已投稿' },
    { value: 'pending', label: '等待回复' },
    { value: 'accepted', label: '已过稿' },
    { value: 'rejected', label: '已退稿' },
    { value: 'published', label: '已发表' },
    { value: 'withdrawn', label: '已撤回' },
  ];

  /** Every status the UI may have to render, selectable or derived. */
  const SUBMIT_STATUS_LABELS = {
    sent: '已投稿',
    pending: '等待回复',
    overdue: '已超期',
    accepted: '已过稿',
    rejected: '已退稿',
    published: '已发表',
    withdrawn: '已撤回',
  };

  const SUBMIT_STATUS_TONE = {
    sent: 'idle',
    pending: 'info',
    overdue: 'warn',
    accepted: 'ok',
    rejected: 'danger',
    published: 'brand',
    withdrawn: 'idle',
  };

  /**
   * R34: 「等待回复」 and 「已超期」 are derived by the host from the mailbox (a
   * reply arrived / the journal's reply window elapsed), so they must not look
   * like something the author can pick — they are shown as a read-only note next
   * to the badge instead of being filter chips.
   */
  const SUBMIT_DERIVED_NOTE = {
    reply: '期刊已回信，等待决定',
    window: '超过该刊常见回复周期',
    awaiting: '',
  };

  function statusLabelOf(value) {
    const key = String(value || 'sent');
    if (SUBMIT_STATUS_LABELS[key]) return SUBMIT_STATUS_LABELS[key];
    for (let i = 0; i < SUBMIT_STATUS_OPTIONS.length; i += 1) {
      if (SUBMIT_STATUS_OPTIONS[i].value === key) return SUBMIT_STATUS_OPTIONS[i].label;
    }
    return key;
  }

  NW.dialogs.SubmitManager = function SubmitManager(props) {
    const p = props || {};
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');

    const load = async () => {
      if (!(NW.io && NW.io.submit && NW.io.submit.record)) {
        setRows([]);
        setError('当前版本不支持投稿记录');
        return;
      }
      try {
        const data = await NW.io.submit.record();
        setRows(Array.isArray(data && data.records) ? data.records : []);
        setError('');
      } catch (err) {
        setRows([]);
        setError(errText(err, '读取投稿记录失败'));
      }
    };

    useEffect(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const mark = async (row, status) => {
      if (!(NW.io && NW.io.submit && NW.io.submit.update)) {
        setError('当前版本不支持修改投稿状态');
        return;
      }
      setBusy('正在保存…');
      try {
        await NW.io.submit.update({ id: String(row.id), status: status });
        await load();
        // R34 a: the home screen holds its own copy of the log, so a status
        // changed here has to be pushed back or the 投稿记录 card keeps
        // showing the old badge until the next boot.
        if (typeof p.onSubmissionChanged === 'function') await p.onSubmissionChanged();
        if (typeof p.onToast === 'function') p.onToast('已标记为「' + statusLabelOf(status) + '」', 'ok');
      } catch (err) {
        setError(errText(err, '保存投稿状态失败'));
      } finally {
        setBusy('');
      }
    };

    const list = Array.isArray(rows) ? rows : [];
    const shown = filter === 'all' ? list : list.filter((row) => String(row && row.status) === filter);

    /**
     * R41 ③: what to print as the work's name.
     *
     * The host stores the title as a snapshot — it is what the editor received,
     * and rewriting it after a rename would falsify the record. The book itself
     * is tracked by `novelId`, so the current name is resolvable: when the two
     * disagree the row says 「现名（投稿时：旧名）」 instead of silently showing a
     * name the author no longer uses. A record from before R41 has no id, and a
     * deleted book no longer resolves, so the snapshot stays the fallback.
     */
    const liveTitles = new Map();
    for (const novel of Array.isArray(p.novels) ? p.novels : []) {
      if (novel && novel.id != null) liveTitles.set(String(novel.id), String(novel.title || '').trim());
    }
    const titleOf = (row) => {
      const stored = String((row && row.title) || '').trim();
      const fallback = stored || String((row && row.subject) || '') || '未命名稿件';
      const id = row && row.novelId != null ? String(row.novelId) : '';
      const live = id ? liveTitles.get(id) || '' : '';
      if (!live || live === stored) return fallback;
      return live + '（投稿时：' + (stored || '未命名稿件') + '）';
    };

    /**
     * R42: a record can fail to follow its book for two reasons, and both are
     * fixable by hand — the id is missing (the record predates R41-fix, which is
     * every submission sent before the id was forwarded at all), or the book it
     * points at is gone (deleted, or dropped by a phone↔desktop sync). Neither
     * is recoverable automatically: titles are not unique, a rename leaves no
     * trace in the database, and several deleted books can share the old name.
     * So the row offers 「关联稿件」 and the author says which book it was.
     */
    const needsLink = (row) => {
      const id = row && row.novelId != null ? String(row.novelId) : '';
      return !id || !liveTitles.has(id);
    };

    const link = async (row, novelId) => {
      if (!(NW.io && NW.io.submit && NW.io.submit.update)) {
        setError('当前版本不支持修改投稿记录');
        return;
      }
      setBusy('正在保存…');
      try {
        await NW.io.submit.update({ id: String(row.id), novelId: String(novelId || '') });
        await load();
        if (typeof p.onSubmissionChanged === 'function') await p.onSubmissionChanged();
        if (typeof p.onToast === 'function') {
          p.onToast(novelId ? '已关联到《' + (liveTitles.get(String(novelId)) || '') + '》' : '已取消关联', 'ok');
        }
      } catch (err) {
        setError(errText(err, '关联稿件失败'));
      } finally {
        setBusy('');
      }
    };

    const dayText = (row) => {
      const at = Number(row && row.at) || 0;
      const days = Number(row && row.daysAgo);
      const when = at ? NW.fmtDate(at) : '—';
      return Number.isFinite(days) && days > 0 ? when + ' · ' + days + ' 天前' : when;
    };

    const body = [];
    if (rows == null) body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner('读取投稿记录…')));
    else if (list.length === 0) body.push(NW.ui.empty('还没有投稿记录。在「投稿助手」里发出第一封投稿后，这里会显示状态。'));
    else {
      body.push(
        h(
          'div',
          { className: 'nw-submit-filters', role: 'tablist', 'aria-label': '按状态筛选' },
          [{ value: 'all', label: '全部' }]
            .concat(SUBMIT_STATUS_OPTIONS)
            .map((option) =>
              h(
                'button',
                {
                  key: option.value,
                  type: 'button',
                  role: 'tab',
                  className: 'nw-chip',
                  'data-active': filter === option.value ? '1' : '0',
                  'aria-selected': filter === option.value ? 'true' : 'false',
                  onClick: () => setFilter(option.value),
                },
                option.label,
              ),
            ),
        ),
      );
      if (shown.length === 0) {
        body.push(h('p', { className: 'nw-hint-block' }, '这个状态下没有投稿记录。'));
      } else {
        body.push(
          h(
            'div',
            { className: 'nw-submit-table', role: 'list' },
            shown.map((row) => {
              // R34: 「等待回复」/「已超期」 come from the host's read-time
              // derivation, so they are reported, not offered — the select stays
              // pinned to what the author actually chose.
              const note = SUBMIT_DERIVED_NOTE[String(row.statusReason || '')] || '';
              const chosen = String(row.statusStored || row.status || 'sent');
              return h(
                'div',
                { key: String(row.id), className: 'nw-submit-line', role: 'listitem' },
                h(
                  'span',
                  { className: 'nw-submit-line-main' },
                  h('span', { className: 'nw-submit-line-title' }, titleOf(row)),
                  h(
                    'span',
                    { className: 'nw-submit-line-meta' },
                    String(row.journalName || '未注明期刊') + ' · ' + dayText(row) +
                      (note ? ' · ' + note : '') +
                      (row.statusDerived && row.responseDays ? ` · 该刊常见回复期 ${row.responseDays} 天` : ''),
                  ),
                ),
                h('span', { className: 'nw-badge', 'data-tone': SUBMIT_STATUS_TONE[String(row.status)] || 'idle' }, statusLabelOf(row.status)),
                h(
                  'span',
                  { className: 'nw-submit-line-actions' },
                  needsLink(row)
                    ? h(
                        'span',
                        { className: 'nw-submit-line-link', title: '这条记录还没跟着某本书，选一本就能显示它的现名' },
                        NW.ui.select({
                          value: '',
                          onChange: (value) => {
                            if (!value) return;
                            link(row, value);
                          },
                          options: [{ value: '', label: '关联稿件…' }].concat(
                            Array.from(liveTitles.entries())
                              .map(([id, title]) => ({ value: id, label: title || '未命名小说' }))
                              .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
                          ),
                          ariaLabel: '把这条投稿记录关联到一本书',
                          style: { minWidth: '96px' },
                        }),
                      )
                    : null,
                  NW.ui.select({
                    value: chosen,
                    onChange: (value) => mark(row, value),
                    options: SUBMIT_STATUS_OPTIONS,
                    ariaLabel: '修改投稿状态',
                    style: { minWidth: '104px' },
                  }),
                  NW.ui.btn({
                    onClick: () => {
                      if (typeof p.onResubmit === 'function') p.onResubmit(row);
                    },
                    children: '重新投稿',
                  }),
                ),
              );
            }),
          ),
        );
      }
    }
    if (error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, error));
    if (busy) body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner(busy)));

    return modal(
      '投稿管理',
      h('div', null, body),
      h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        NW.ui.btn({ onClick: load, disabled: !!busy, children: NW.t('刷新') }),
        closeBtn(p),
      ),
      '760px',
      p.onClose,
    );
  };

  // ========================================================== Journals ======
  /**
   * 期刊库 — the full editable directory (79 built-in entries in R5). Each row
   * shows whether its inbox has been confirmed; editing it persists a delta
   * through `journals.save`, so a later release can still improve the defaults.
   */
  NW.dialogs.Journals = function Journals(props) {
    const p = props || {};
    const [rows, setRows] = useState(null);
    const [query, setQuery] = useState('');
    const [onlyMissing, setOnlyMissing] = useState(false);
    const [editing, setEditing] = useState(null);
    // R32 ②: the row editor works on this array; form.emailRows mirrors it so a
    // plain setForm() elsewhere never loses what the author typed.
    const [emailRows, setEmailRows] = useState([]);
    const [form, setForm] = useState({ name: '', email: '', website: '', wordRange: '', requirements: '', emails: '' });
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    // R7 ②: paste a magazine's 征稿启事 list and land it on the right rows.
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState('');
    const [importReport, setImportReport] = useState('');
    // R11 ⑦: `editing === NEW_JOURNAL` opens the same form in create mode.
    const NEW_JOURNAL = '\u0000new';

    const load = async () => {
      if (!(NW.io && NW.io.journals && NW.io.journals.list)) {
        setRows([]);
        setError('当前版本不支持期刊库');
        return;
      }
      try {
        const data = await NW.io.journals.list();
        setRows(Array.isArray(data && data.journals) ? data.journals : []);
        setError('');
      } catch (err) {
        setRows([]);
        setError(errText(err, '读取期刊库失败'));
      }
    };

    useEffect(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startEdit = (entry) => {
      setEditing(String(entry.id));
      setForm({
        name: String(entry.name || ''),
        email: String(entry.email || ''),
        website: String(entry.website || ''),
        wordRange: String(entry.wordRange || ''),
        requirements: (Array.isArray(entry.requirements) ? entry.requirements : []).join('\n'),
        // R32 ②: the row editor is the only representation of the per-体裁
        // inboxes now; this string is kept empty for older call sites.
        emails: '',
        emailRows: [],
      });
      setEmailRows(variantRowsOf(entry.emails));
    };

    /** R11 ⑦: start a blank record — the id is derived from the name on save. */
    const startCreate = () => {
      setEditing(NEW_JOURNAL);
      setForm({ name: '', email: '', website: '', wordRange: '', requirements: '', emails: '', emailRows: [] });
      setEmailRows([]);
      setError('');
    };

    const setEmailRow = (index, patch) => {
      setEmailRows((prev) => prev.map((row, i) => (i === index ? Object.assign({}, row, patch) : row)));
    };

    const toggleRowGenre = (current, value) =>
      current.indexOf(value) >= 0 ? current.filter((item) => item !== value) : current.concat([value]);

    const addEmailRow = () => {
      setEmailRows((prev) => prev.concat([{ email: '', genres: [], range: '', note: '' }]));
    };

    const removeEmailRow = (index) => {
      setEmailRows((prev) => prev.filter((row, i) => i !== index));
    };

    const saveEdit = async () => {
      const creating = editing === NEW_JOURNAL;
      const entry = creating
        ? { id: '', name: '', aliases: [], genres: {}, requirements: [], emails: [], tags: [] }
        : (rows || []).filter((row) => String(row.id) === String(editing))[0];
      if (!entry) return;
      const name = String(form.name || '').trim();
      if (creating && !name) {
        setError('请填写期刊名称');
        return;
      }
      setBusy('正在保存…');
      setError('');
      try {
        const requirements = String(form.requirements || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const id = creating
          ? NW.io.journals.newId(name, (rows || []).map((row) => row.id))
          : String(entry.id);
        await NW.io.journals.save([
          Object.assign({}, entry, {
            id: id,
            name: name || String(entry.name || ''),
            email: String(form.email || '').trim(),
            website: String(form.website || '').trim(),
            wordRange: String(form.wordRange || '').trim(),
            requirements: requirements,
            // R32 ②: rows win over the textarea. A row whose address has no
            // '@' is simply not saved — the old pipe grammar dropped the whole
            // line silently, which is how a four-inbox journal ended up with one.
            emails: (Array.isArray(emailRows) ? emailRows : [])
              .map(variantFromRow)
              .filter(Boolean),
            verified: Boolean(String(form.email || '').trim()),
          }),
        ]);
        await load();
        setEditing(null);
        if (typeof p.onToast === 'function') {
          p.onToast(creating ? '已新增期刊《' + name + '》' : '期刊信息已保存', 'ok');
        }
      } catch (err) {
        setError(errText(err, '保存期刊信息失败'));
      } finally {
        setBusy('');
      }
    };

    /**
     * R11 ⑦: delete one journal. A shipped journal is tombstoned on the host so
     * it stays gone, which is why this asks before doing it — there is no undo
     * beyond re-adding a journal with the same name.
     */
    const removeJournal = async (entry) => {
      const name = String((entry && entry.name) || '');
      const ok = await NW.ui.confirm(
        '删除《' + name + '》？删除后不再出现在期刊库与投稿向导里，需要时可以重新新增。',
        { title: '删除期刊', danger: true, okText: '删除' },
      );
      if (!ok) return;
      setBusy('正在删除…');
      setError('');
      try {
        await NW.io.journals.remove(entry.id);
        if (String(editing) === String(entry.id)) setEditing(null);
        await load();
        if (typeof p.onToast === 'function') p.onToast('已删除《' + name + '》', 'ok');
      } catch (err) {
        setError(errText(err, '删除期刊失败'));
      } finally {
        setBusy('');
      }
    };

    const doImport = async (dryRun) => {
      const text = String(importText || '').trim();
      if (!text) {
        setError('请先粘贴「期刊名 | 邮箱」内容');
        return;
      }
      setBusy(dryRun ? '正在校验…' : '正在导入…');
      setError('');
      try {
        const data = await NW.io.journals.importEmails(text, dryRun);
        const updated = Number(data && data.updated) || 0;
        const added = Number(data && data.added) || 0;
        const unmatched = (data && data.unmatched) || [];
        const skipped = (data && data.skipped) || [];
        const lines = [];
        lines.push((dryRun ? '预演：' : '已导入：') + updated + ' 家期刊，新增 ' + added + ' 个分体裁邮箱。');
        if (unmatched.length) {
          lines.push('清单里没有这些刊（可先用「编辑」手动改别名）：' + unmatched.map((row) => row.journal).join('、'));
        }
        if (skipped.length) {
          lines.push('忽略了 ' + skipped.length + ' 行：' + skipped.slice(0, 3).map((row) => '第 ' + row.line + ' 行 ' + row.reason).join('；'));
        }
        setImportReport(lines.join('\n'));
        if (!dryRun) {
          await load();
          if (typeof p.onToast === 'function') p.onToast('已导入 ' + updated + ' 家期刊的邮箱', 'ok');
        }
      } catch (err) {
        setError(errText(err, dryRun ? '校验失败' : '导入邮箱失败'));
      } finally {
        setBusy('');
      }
    };

    const list = Array.isArray(rows) ? rows : [];
    const text = String(query || '').trim().toLowerCase();
    const shown = list.filter((entry) => {
      if (onlyMissing && String(entry.email || '').trim()) return false;
      if (!text) return true;
      const names = [entry.name].concat(Array.isArray(entry.aliases) ? entry.aliases : []).concat(Array.isArray(entry.tags) ? entry.tags : []);
      return names.some((name) => String(name || '').toLowerCase().indexOf(text) >= 0);
    });
    const withEmail = list.filter((entry) => String(entry.email || '').trim()).length;

    const body = [];
    body.push(
      h(
        'div',
        { className: 'nw-journal-toolbar' },
        NW.ui.input({ value: query, placeholder: '搜索期刊名、别名或标签', onChange: (v) => setQuery(v), ariaLabel: '搜索期刊' }),
        NW.ui.btn({
          active: onlyMissing,
          onClick: () => setOnlyMissing((v) => !v),
          children: onlyMissing ? '只看待核对' : '全部期刊',
        }),
        NW.ui.btn({
          active: importOpen,
          onClick: () => {
            setImportOpen((v) => !v);
            setImportReport('');
          },
          children: '批量导入邮箱',
        }),
        // R11 ⑦: the library is now fully editable, not just overridable.
        NW.ui.btn({ kind: 'primary', onClick: startCreate, children: '新增期刊' }),
      ),
    );
    body.push(
      h(
        'p',
        { className: 'nw-hint-block' },
        rows == null
          ? '正在读取…'
          : '共 ' + list.length + ' 家，其中 ' + withEmail + ' 家已收录投稿邮箱。' + '邮箱与要求以期刊官方最新征稿启事为准，投稿前请再核对一次。',
      ),
    );

    if (importOpen) {
      body.push(
        h(
          'div',
          { className: 'nw-journal-edit' },
          h('h4', null, '批量导入投稿邮箱'),
          h(
            'p',
            { className: 'nw-hint-block' },
            '从期刊官网的征稿启事里把邮箱复制成一行一家，格式：期刊名 | 邮箱 | 体裁 | 字数 | 备注。后三列可留空（留空就是这家刊的通用邮箱）；填了体裁或字数就会记成「短篇/中篇/长篇各用不同邮箱」的分列邮箱。',
          ),
          NW.ui.textarea({
            rows: 7,
            value: importText,
            placeholder: '钟山 | zhongs@example.com | 短篇,中篇 | 5000-30000 | 只收现实题材\n钟山 | zscp@example.com | 长篇 | 80000以上',
            onChange: (v) => setImportText(v),
            ariaLabel: '批量导入的邮箱列表',
          }),
          h(
            'div',
            { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
            NW.ui.btn({ onClick: () => doImport(true), disabled: !!busy, children: '先预演一下' }),
            NW.ui.btn({ kind: 'primary', onClick: () => doImport(false), disabled: !!busy, children: '导入' }),
          ),
          importReport
            ? h('pre', { className: 'nw-attach-text', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, importReport)
            : null,
        ),
      );
    }

    if (rows == null) {
      body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner('读取期刊库…')));
    } else if (shown.length === 0) {
      body.push(NW.ui.empty('没有匹配的期刊。'));
    } else {
      body.push(
        h(
          'div',
          { className: 'nw-journal-table', role: 'list' },
          shown.slice(0, 200).map((entry) =>
            h(
              'div',
              { key: String(entry.id), className: 'nw-journal-row', role: 'listitem' },
              h(
                'span',
                { className: 'nw-journal-row-main' },
                h('span', { className: 'nw-journal-row-name' }, String(entry.name || '')),
                h(
                  'span',
                  { className: 'nw-journal-row-meta' },
                  String(entry.wordRange || '字数未注明'),
                ),
                // R32: every inbox on its own line — a journal with four
                // addresses used to read as one address plus "另有 3 个", which
                // is exactly the state that made 「只能编辑一个」 believable.
                h(
                  'span',
                  { className: 'nw-journal-mails' },
                  journalMailLines(entry).map((line, lineIndex) =>
                    h(
                      'span',
                      {
                        key: 'mail-' + String(entry.id) + '-' + String(lineIndex),
                        className: 'nw-journal-mail',
                        'data-main': lineIndex === 0 && line.main ? '1' : '0',
                      },
                      h('span', { className: 'nw-journal-mailaddr' }, line.email),
                      line.tags ? h('span', { className: 'nw-journal-mailtags' }, line.tags) : null,
                    ),
                  ),
                ),
              ),
              String(entry.email || '').trim() ? badge(String(entry.verified ? '已核对' : '待核对'), entry.verified ? 'ok' : 'warn') : badge('待核对', 'warn'),
              NW.ui.btn({ onClick: () => startEdit(entry), children: '编辑' }),
              NW.ui.btn({
                kind: 'ghost',
                onClick: () => removeJournal(entry),
                disabled: !!busy,
                title: '删除',
                ariaLabel: '删除《' + String(entry.name || '') + '》',
                children: '删除',
              }),
            ),
          ),
        ),
      );
    }

    if (editing) {
      const creating = editing === NEW_JOURNAL;
      const editingName = creating
        ? String(form.name || '').trim()
        : String(((rows || []).filter((row) => String(row.id) === String(editing))[0] || {}).name || '');
      body.push(
        h(
          'div',
          { className: 'nw-journal-edit' },
          h('h4', null, (creating ? '新增期刊' : '编辑：' + editingName)),
          creating
            ? NW.ui.field({
                label: '期刊名称',
                hint: '会显示在期刊库和投稿向导里；内部 id 由名称自动生成。',
                children: NW.ui.input({
                  value: form.name,
                  placeholder: '例如：青年作家',
                  onChange: (v) => setForm(Object.assign({}, form, { name: v })),
                }),
              })
            : null,
          NW.ui.field({
            label: '默认收稿邮箱',
            hint: '不带任何分类条件的通用邮箱。下面按体裁 / 篇幅单独登记了的，投稿时会优先用那一行。',
            children: NW.ui.input({ value: form.email, placeholder: '编辑部收稿邮箱', onChange: (v) => setForm(Object.assign({}, form, { email: v })) }),
          }),
          NW.ui.field({
            label: '官网 / 投稿页',
            children: NW.ui.input({ value: form.website, placeholder: 'https://', onChange: (v) => setForm(Object.assign({}, form, { website: v })) }),
          }),
          NW.ui.field({
            label: '字数区间',
            children: NW.ui.input({ value: form.wordRange, onChange: (v) => setForm(Object.assign({}, form, { wordRange: v })) }),
          }),
          emailRowEditor(emailRows, {
            setRow: setEmailRow,
            addRow: addEmailRow,
            removeRow: removeEmailRow,
            toggleGenre: toggleRowGenre,
          }),
          NW.ui.field({
            label: '投稿要求（每行一条）',
            children: NW.ui.textarea({
              rows: 5,
              value: form.requirements,
              onChange: (v) => setForm(Object.assign({}, form, { requirements: v })),
              ariaLabel: '投稿要求',
            }),
          }),
          h(
            'div',
            { className: 'nw-inline', style: { gap: '6px', flexWrap: 'wrap' } },
            NW.ui.btn({ kind: 'primary', onClick: saveEdit, disabled: !!busy, children: creating ? '新增' : NW.t('保存') }),
            NW.ui.btn({ onClick: () => setEditing(null), disabled: !!busy, children: '取消' }),
            creating
              ? null
              : NW.ui.btn({
                  kind: 'ghost',
                  onClick: () => {
                    const entry = (rows || []).filter((row) => String(row.id) === String(editing))[0];
                    if (entry) removeJournal(entry);
                  },
                  disabled: !!busy,
                  children: '删除这家期刊',
                }),
          ),
        ),
      );
    }

    if (error) body.push(h('div', { className: 'nw-lock-error', role: 'alert' }, error));
    if (busy) body.push(h('div', { className: 'nw-inline' }, NW.ui.spinner(busy)));

    return modal(
      '期刊库',
      h('div', null, body),
      h('div', { style: { display: 'flex', gap: '8px' } }, closeBtn(p)),
      '820px',
      p.onClose,
    );
  };
})();