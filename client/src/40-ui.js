;(() => {
  'use strict';

  NW.CSS_PARTS.push(`
.nw-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:var(--nw-sp-0);
  padding:4px 10px;border-radius:var(--nw-r-control);border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;
  cursor:pointer;white-space:nowrap;font-family:inherit;transition:background var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);}
.nw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.nw-btn:disabled{opacity:.45;cursor:not-allowed;}
.nw-btn[data-kind="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;}
.nw-btn[data-kind="primary"]:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-brand-primary);}
.nw-btn[data-kind="danger"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l1);}
.nw-btn[data-kind="danger"]:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:#fff;}
.nw-btn[data-kind="ghost"]{border-color:transparent;color:var(--dsw-alias-label-secondary);}
.nw-btn[data-kind="ghost"]:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}
.nw-btn[data-kind="icon"]{padding:3px;width:24px;height:24px;border-color:transparent;background:transparent;}
.nw-btn[data-kind="icon"]:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}
.nw-btn[data-active="1"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}

.nw-input,.nw-select,.nw-textarea{
  width:100%;padding:5px 8px;border-radius:var(--nw-r-control);border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-family:inherit;font-size:12px;line-height:18px;outline:none;
}
.nw-input:focus,.nw-select:focus,.nw-textarea:focus{border-color:var(--dsw-alias-brand-primary);}
.nw-textarea{resize:vertical;min-height:64px;}
.nw-select{cursor:pointer;}
.nw-field{display:flex;flex-direction:column;gap:4px;margin-bottom:var(--nw-sp-2);}
.nw-field > label{font-size:var(--nw-fs-tiny);color:var(--dsw-alias-label-secondary);}
.nw-field .nw-hint{font-size:var(--nw-fs-tiny);color:var(--dsw-alias-label-secondary);opacity:.85;}
.nw-inline{display:flex;align-items:center;gap:var(--nw-sp-1);}
.nw-row{display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-2);padding:7px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1);}
.nw-row:last-child{border-bottom:none;}
.nw-switch{position:relative;display:inline-block;width:34px;height:19px;flex:0 0 auto;cursor:pointer;}
.nw-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}
.nw-switch i{position:absolute;inset:0;border-radius:var(--nw-r-pill);background:var(--dsw-alias-border-l2);transition:background var(--nw-dur);}
.nw-switch i::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;
  background:#fff;transition:transform var(--nw-dur);box-shadow:0 1px 2px rgba(0,0,0,.25);}
.nw-switch input:checked + i{background:var(--dsw-alias-brand-primary);}
.nw-switch input:checked + i::after{transform:translateX(15px);}
.nw-switch input:focus-visible + i{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}

.nw-modal-mask{position:absolute;inset:0;z-index:var(--nw-z-modal);display:flex;align-items:center;justify-content:center;
  background:rgba(8,10,14,.42);backdrop-filter:blur(1.5px);padding:var(--nw-sp-5);}
.nw-modal{display:flex;flex-direction:column;max-height:100%;width:100%;max-width:560px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--nw-r-card);
  box-shadow:var(--nw-shadow-3);overflow:hidden;animation:nw-pop var(--nw-dur) ease-out;}
@keyframes nw-pop{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
.nw-modal-head{display:flex;align-items:center;gap:var(--nw-sp-1);padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.nw-modal-head h2{margin:0;font-size:13px;font-weight:600;flex:1;}
.nw-modal-body{padding:var(--nw-sp-4);overflow:auto;flex:1 1 auto;min-height:0;}
.nw-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:var(--nw-sp-1);padding:10px 14px;
  border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);}
.nw-toast-wrap{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:var(--nw-z-toast);
  display:flex;flex-direction:column;gap:var(--nw-sp-0);align-items:center;pointer-events:none;}
.nw-toast{padding:6px 14px;border-radius:var(--nw-r-pill);font-size:var(--nw-fs-tiny);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);
  box-shadow:var(--nw-shadow-2);animation:nw-toast-in var(--nw-dur) var(--nw-ease,ease-out);max-width:70%;}
.nw-toast[data-kind="ok"]{border-color:var(--dsw-alias-state-success-primary);}
.nw-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary);}
@keyframes nw-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.nw-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);
  border-top-color:var(--dsw-alias-brand-primary);animation:nw-spin .7s linear infinite;display:inline-block;}
@keyframes nw-spin{to{transform:rotate(360deg)}}
.nw-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--nw-sp-1);
  padding:28px 18px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;height:100%;}
.nw-empty svg{opacity:.5;}
.nw-rowitem{display:flex;align-items:center;gap:var(--nw-sp-1);padding:5px 8px;border-radius:var(--nw-r-control);cursor:pointer;
  color:var(--dsw-alias-label-primary);font-size:12px;min-width:0;}
.nw-rowitem:hover{background:var(--dsw-alias-bg-layer-2);}
.nw-rowitem[data-active="1"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600;}
.nw-rowitem .nw-rowmeta{margin-left:auto;font-size:var(--nw-fs-tiny);color:var(--dsw-alias-label-secondary);white-space:nowrap;
  font-variant-numeric:tabular-nums;}
`);

  const cx = (...parts) => parts.filter(Boolean).join(' ');

  function Btn(props) {
    const p = props || {};
    const kind = p.kind || 'default';
    return h(
      'button',
      {
        type: 'button',
        className: cx('nw-btn', p.className),
        'data-kind': kind,
        'data-active': p.active ? '1' : '0',
        title: p.title || undefined,
        'aria-label': p.ariaLabel || p.title || undefined,
        disabled: !!p.disabled,
        onClick: p.disabled ? undefined : p.onClick,
        style: p.style,
      },
      p.children,
    );
  }

  function IconBtn(label, title, onClick, opts) {
    const o = opts || {};
    return h(
      'button',
      {
        type: 'button',
        className: 'nw-btn',
        'data-kind': 'icon',
        title,
        'aria-label': title || label,
        'aria-pressed': o.active ? 'true' : undefined,
        onClick,
        style: o.style,
      },
      h('span', { 'aria-hidden': 'true', style: { fontSize: '13px', lineHeight: 1 } }, label),
    );
  }

  function Field(props) {
    return h(
      'div',
      { className: 'nw-field' },
      props.label ? h('label', null, props.label) : null,
      props.children,
      props.hint ? h('span', { className: 'nw-hint' }, props.hint) : null,
    );
  }

  function Input(props) {
    const p = props || {};
    return h('input', {
      className: cx('nw-input', p.className),
      type: p.type || 'text',
      value: p.value === undefined || p.value === null ? '' : p.value,
      placeholder: p.placeholder,
      style: p.style,
      autoFocus: p.autoFocus,
      disabled: p.disabled,
      spellCheck: false,
      onChange: (ev) => p.onChange && p.onChange(ev.target.value, ev),
      onKeyDown: p.onKeyDown,
      onBlur: p.onBlur,
      'aria-label': p.ariaLabel || p.placeholder,
    });
  }

  function TextArea(props) {
    const p = props || {};
    return h('textarea', {
      className: cx('nw-textarea', p.className),
      value: p.value === undefined || p.value === null ? '' : p.value,
      placeholder: p.placeholder,
      style: p.style,
      rows: p.rows || 4,
      autoFocus: p.autoFocus,
      onChange: (ev) => p.onChange && p.onChange(ev.target.value, ev),
      onKeyDown: p.onKeyDown,
      'aria-label': p.ariaLabel || p.placeholder,
    });
  }

  function Select(props) {
    const p = props || {};
    return h(
      'select',
      {
        className: cx('nw-select', p.className),
        value: p.value === undefined || p.value === null ? '' : p.value,
        style: p.style,
        disabled: p.disabled,
        onChange: (ev) => p.onChange && p.onChange(ev.target.value),
        'aria-label': p.ariaLabel,
      },
      (p.options || []).map((opt) =>
        h('option', { key: String(opt.value), value: opt.value }, opt.label),
      ),
    );
  }

  function Toggle(props) {
    const p = props || {};
    return h(
      'label',
      { className: 'nw-switch', title: p.title },
      h('input', {
        type: 'checkbox',
        checked: !!p.checked,
        onChange: (ev) => p.onChange && p.onChange(ev.target.checked),
        'aria-label': p.label || p.title,
      }),
      h('i', { 'aria-hidden': 'true' }),
    );
  }

  function Modal(props) {
    const p = props || {};
    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.key === 'Escape' && p.onClose) {
          ev.stopPropagation();
          p.onClose();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [p.onClose]);
    return h(
      'div',
      {
        className: 'nw-modal-mask',
        role: 'presentation',
        onPointerDown: (ev) => {
          if (ev.target === ev.currentTarget && p.onClose) p.onClose();
        },
      },
      h(
        'div',
        {
          className: 'nw-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': p.title,
          style: p.width ? { maxWidth: p.width } : undefined,
        },
        h(
          'div',
          { className: 'nw-modal-head' },
          h('h2', null, p.title),
          h(IconBtn, { label: '✕', title: NW.t('关闭'), onClick: p.onClose }),
        ),
        h('div', { className: 'nw-modal-body' }, p.children),
        p.footer ? h('div', { className: 'nw-modal-foot' }, p.footer) : null,
      ),
    );
  }

  // ---- promise-based prompts are mounted by the App through these hooks ----
  const modalHost = { request: null };
  NW.uiModalHost = modalHost;

  function confirmAsync(text, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      if (!modalHost.request) {
        resolve(window.confirm(text));
        return;
      }
      modalHost.request({
        kind: 'confirm',
        title: o.title || NW.t('确认删除'),
        text,
        danger: !!o.danger,
        okText: o.okText || NW.t('确定'),
        resolve,
      });
    });
  }

  function promptAsync(opts) {
    const o = typeof opts === 'string' ? { label: opts } : opts || {};
    return new Promise((resolve) => {
      if (!modalHost.request) {
        resolve(window.prompt(o.label || '', o.value || ''));
        return;
      }
      modalHost.request({
        kind: 'prompt',
        title: o.title || NW.t('重命名'),
        label: o.label || '',
        value: o.value || '',
        placeholder: o.placeholder || '',
        multiline: !!o.multiline,
        resolve,
      });
    });
  }

  const toastBus = { push: null };
  NW.uiToastBus = toastBus;

  /**
   * Segmented control (`.nw-seg`). Values are plain strings; the active one is
   * rendered as a primary button so the styles layer can highlight it without a
   * dedicated class.
   */
  function Seg(props) {
    const p = props || {};
    const options = Array.isArray(p.options) ? p.options : [];
    const value = String(p.value == null ? '' : p.value);
    return h(
      'div',
      { className: 'nw-seg', role: 'group', 'aria-label': p.ariaLabel || undefined },
      options.map((opt) =>
        h(
          'button',
          {
            key: String(opt.value),
            type: 'button',
            className: 'nw-btn',
            'data-kind': String(opt.value) === value ? 'primary' : 'ghost',
            'data-active': String(opt.value) === value ? '1' : '0',
            'aria-pressed': String(opt.value) === value ? 'true' : 'false',
            title: opt.title || undefined,
            onClick: p.disabled ? undefined : () => p.onChange && p.onChange(String(opt.value)),
          },
          opt.label,
        ),
      ),
    );
  }

  NW.ui = {
    btn: Btn,
    iconBtn: IconBtn,
    field: Field,
    input: Input,
    textarea: TextArea,
    select: Select,
    toggle: Toggle,
    seg: Seg,
    modal: Modal,
    confirm: confirmAsync,
    prompt: promptAsync,
    toast(message, kind) {
      if (toastBus.push) toastBus.push(message, kind || 'info');
      else if (typeof console !== 'undefined') console.log('[novel-writer]', message);
    },
    spinner(label) {
      return h(
        'span',
        { className: 'nw-inline', role: 'status' },
        h('i', { className: 'nw-spin', 'aria-hidden': 'true' }),
        label ? h('span', { className: 'nw-dim' }, label) : null,
      );
    },
    empty(text, extra) {
      return h(
        'div',
        { className: 'nw-empty' },
        h(
          'svg',
          { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('path', {
            d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H10l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 19H5.5A1.5 1.5 0 0 1 4 17.5v-12Z',
            stroke: 'currentColor',
            strokeWidth: 1.4,
          }),
        ),
        h('span', null, text),
        extra || null,
      );
    },
    listRow(props) {
      const p = props || {};
      return h(
        'div',
        {
          className: 'nw-rowitem',
          'data-active': p.active ? '1' : '0',
          role: 'button',
          tabIndex: 0,
          onClick: p.onClick,
          onKeyDown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              if (p.onClick) p.onClick(ev);
            }
          },
        },
        p.icon || null,
        h('span', { className: 'nw-nowrap', style: { minWidth: 0 } }, p.title),
        p.meta ? h('span', { className: 'nw-rowmeta' }, p.meta) : null,
        p.actions || null,
      );
    },
    row(props) {
      const p = props || {};
      return h(
        'div',
        { className: 'nw-row' },
        h('span', { style: { fontSize: '12px' } }, p.label),
        p.children,
      );
    },
    shell: NW.Shell,
    statusBar: NW.StatusBar,
    splitter: NW.Splitter,
  };
})();
