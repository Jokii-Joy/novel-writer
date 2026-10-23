;(() => {
  'use strict';

  // ===========================================================================
  // 05-css.js — the shell's visual language (Claude edition).
  //
  // A warm, quiet writing tool: paper under paper, hairlines instead of boxes,
  // serif where a title should feel read and sans where a control must feel
  // pushed. Every colour is an alias token re-mapped per theme in
  // 98-shell-theme.js; the only literals here are neutral black alphas, which
  // have no token peer.
  //
  //   type     16px / 1.55 base · 14px secondary · 13px micro · 17px panel title
  //   corners  card 12 · control 10 · modal 16 · pill 999
  //   metrics  toolbar 52 · status 34 · button 36 · icon 34 · input 38
  //   rhythm   8 / 10 / 12 / 16
  //
  // The tokens below are the single source of truth for the whole plugin; later
  // parts consume and refine them instead of inventing their own numbers.
  // ===========================================================================
  NW.CSS_PARTS.push(`
/* ---------------------------------------------------------------- tokens -- */
.nw-root{
  --nw-ui-font:var(--nw-ui-font-override,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);
  --nw-reading-font:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Songti SC","Noto Serif CJK SC",
    "Source Han Serif SC","Noto Serif SC",STSong,SimSun,serif;

  /* type */
  --nw-fs-base:16px;
  --nw-fs-second:14px;
  --nw-fs-micro:13px;
  --nw-fs-title:17px;
  --nw-lh-base:1.55;

  /* radii */
  --nw-r-card:12px;
  --nw-r-control:10px;
  --nw-r-modal:16px;
  --nw-r-pill:999px;

  /* metrics */
  --nw-h-btn:36px;
  --nw-h-iconbtn:34px;
  --nw-h-input:38px;
  --nw-h-toolbar:52px;
  --nw-h-status:34px;

  /* rhythm */
  --nw-sp-1:8px;--nw-sp-2:10px;--nw-sp-3:12px;--nw-sp-4:16px;--nw-sp-5:20px;--nw-sp-6:24px;

  /* Surfaces. The host's layer tokens are not reliably distinct from the page
     background (in the light theme layer-1/2/overlay are all plain white), so
     elevation is derived from the foreground instead: mixing a trace of ink into
     the paper darkens a light theme and lightens a dark one, which keeps the
     same "stacked page" reading in every palette. */
  --nw-bg:var(--dsw-alias-bg-base);
  --nw-panel:color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, var(--nw-bg));
  --nw-sunken:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--nw-bg));
  --nw-surface-1:var(--nw-panel);
  --nw-surface-2:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--nw-bg));
  --nw-surface-overlay:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--nw-bg));
  --nw-line:var(--dsw-alias-border-l2);
  --nw-line-soft:var(--dsw-alias-border-l1);
  --nw-line-strong:color-mix(in srgb, var(--dsw-alias-label-secondary) 32%, transparent);
  --nw-brand:var(--dsw-alias-brand-primary);
  --nw-fg:var(--dsw-alias-label-primary);
  --nw-fg-soft:var(--dsw-alias-label-secondary);
  --nw-danger:var(--dsw-alias-state-error-primary);
  --nw-ok:var(--dsw-alias-state-success-primary);
  --nw-warn:var(--dsw-alias-state-warn-primary);
  --nw-idle:var(--dsw-alias-state-idle-primary);

  /* neutrals used only for elevation (no token exists for shadows) */
  --nw-shadow-1:0 1px 2px rgba(0,0,0,.04);
  --nw-shadow-2:0 8px 24px rgba(0,0,0,.06);
  --nw-shadow-3:0 2px 6px rgba(0,0,0,.05), 0 24px 64px rgba(0,0,0,.12);
  --nw-ring:0 0 0 2px var(--nw-bg), 0 0 0 4px color-mix(in srgb, var(--nw-brand) 55%, transparent);
  --nw-ring-soft:0 0 0 3px color-mix(in srgb, var(--nw-brand) 16%, transparent);

  position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;
  color:var(--nw-fg);background:var(--nw-bg);
  font-family:var(--nw-ui-font);
  font-size:var(--nw-fs-base);line-height:var(--nw-lh-base);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  text-rendering:optimizeLegibility;overflow:hidden;
  /* R13: the panel is a resizable column inside the host shell, so its width has
     almost nothing to do with the window width. Everything below sizes itself
     against this container instead of the viewport; the @media tiers in
     97-theme.js only remain as a belt-and-braces fallback for old engines. */
  container-type:inline-size;
  container-name:nw;
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-root *{box-sizing:border-box;}
.nw-root ::selection{background:color-mix(in srgb, var(--nw-brand) 22%, transparent);}

/* One focus treatment for everything interactive. :where() keeps the
   specificity at zero so controls that paint their own ring still win. */
.nw-root :where(button, a, input, select, textarea, [tabindex]):focus-visible{
  outline:2px solid var(--nw-brand);outline-offset:2px;
}

/* --------------------------------------------------------------- toolbar -- */
.nw-toolbar{
  display:flex;align-items:center;gap:var(--nw-sp-1);
  padding:0 var(--nw-sp-4);flex:0 0 auto;min-height:var(--nw-h-toolbar);
  border-bottom:1px solid var(--nw-line);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--nw-surface-overlay) 60%, transparent), transparent 82%),
    var(--nw-bg);
  position:relative;z-index:5;
}
/* a hairline of brand under the strip: the only colour in the chrome at rest */
.nw-toolbar::after{
  content:'';position:absolute;left:0;right:0;bottom:-1px;height:1px;pointer-events:none;
  background:linear-gradient(90deg, transparent,
    color-mix(in srgb, var(--nw-brand) 20%, transparent) 20%,
    color-mix(in srgb, var(--nw-brand) 20%, transparent) 80%, transparent);
}
.nw-toolbar .nw-spacer{flex:1 1 auto;min-width:var(--nw-sp-1);}
.nw-title{
  font-family:var(--nw-reading-font);
  font-weight:600;font-size:var(--nw-fs-base);letter-spacing:.02em;
  display:flex;align-items:baseline;gap:8px;color:var(--nw-fg);max-width:38%;min-width:0;
  padding-right:var(--nw-sp-2);
}
.nw-title small{
  font-family:var(--nw-ui-font);font-weight:400;color:var(--nw-fg-soft);
  font-size:var(--nw-fs-second);letter-spacing:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;
}
/* group divider: any 1px span the toolbar emits between button runs */
.nw-toolbar > span[style*="width: 1px"],
.nw-toolbar > span[style*="width:1px"]{
  width:1px !important;height:22px !important;margin:0 6px;
  background:var(--nw-line) !important;flex:0 0 auto;align-self:center;
}

/* ------------------------------------------------------------------ body -- */
.nw-body{display:flex;flex:1 1 auto;min-height:0;position:relative;}
.nw-splitter{
  flex:0 0 8px;cursor:col-resize;background:transparent;position:relative;z-index:3;
  border-left:1px solid var(--nw-line);
  transition:background var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-splitter::after{
  content:'';position:absolute;top:50%;left:3px;transform:translateY(-50%);
  width:2px;height:28px;border-radius:2px;background:var(--nw-line-strong);
  opacity:.5;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease),
    background var(--nw-dur,.18s) var(--nw-ease,ease),
    height var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-splitter:hover::after,.nw-splitter[data-drag="1"]::after{
  background:var(--nw-brand);opacity:1;height:48px;
}
.nw-splitter:hover,.nw-splitter[data-drag="1"]{
  background:color-mix(in srgb, var(--nw-brand) 6%, transparent);
}
.nw-splitter:focus-visible{outline:2px solid var(--nw-brand);outline-offset:-2px;}
.nw-main{
  display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;
  background:var(--nw-bg);position:relative;
}

/* ------------------------------------------------------------ status bar -- */
.nw-status{
  display:flex;align-items:center;gap:var(--nw-sp-4);padding:0 var(--nw-sp-4);flex:0 0 auto;
  min-height:var(--nw-h-status);
  border-top:1px solid var(--nw-line-soft);
  background:var(--nw-bg);
  color:var(--nw-fg-soft);font-size:var(--nw-fs-micro);letter-spacing:.01em;
  font-variant-numeric:tabular-nums;
}
.nw-status > span{display:inline-flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;}
.nw-status .nw-dot{
  width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:2px;flex:0 0 auto;
  background:var(--nw-idle);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-idle) 16%, transparent);
  transition:background var(--nw-dur,.18s) var(--nw-ease,ease),
    box-shadow var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-status .nw-dot[data-state="ok"]{
  background:var(--nw-ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-ok) 16%, transparent);
}
.nw-status .nw-dot[data-state="busy"]{
  background:var(--nw-warn);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-warn) 18%, transparent);
  animation:nw-pulse 1.1s ease-in-out infinite;
}
.nw-status .nw-dot[data-state="err"]{
  background:var(--nw-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-danger) 18%, transparent);
}
@keyframes nw-pulse{0%,100%{opacity:1}50%{opacity:.35}}

/* --------------------------------------------------------------- utility -- */
.nw-scroll{overflow:auto;min-height:0;}
.nw-hidden{display:none !important;}
.nw-dim{color:var(--nw-fg-soft);}
.nw-nowrap{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nw-rule{height:1px;border:0;margin:var(--nw-sp-3) 0;
  background:linear-gradient(90deg, var(--nw-line), transparent);}

/* Slim, quiet scrollbars for every chrome scroller. The editor's own
   .nw-scroll keeps its palette-aware pair — not listed here on purpose. */
.nw-root :where(.nw-modal-body,.nw-suggest-list,.nw-diff,.nw-version-list,
  .nw-preview-text,.nw-journal-list,.nw-journal-detail){
  scrollbar-width:thin;scrollbar-color:var(--nw-line-strong) transparent;
}
.nw-root :where(.nw-modal-body,.nw-suggest-list,.nw-diff,.nw-version-list,
  .nw-preview-text,.nw-journal-list,.nw-journal-detail)::-webkit-scrollbar{width:8px;height:8px;}
.nw-root :where(.nw-modal-body,.nw-suggest-list,.nw-diff,.nw-version-list,
  .nw-preview-text,.nw-journal-list,.nw-journal-detail)::-webkit-scrollbar-track{background:transparent;}
.nw-root :where(.nw-modal-body,.nw-suggest-list,.nw-diff,.nw-version-list,
  .nw-preview-text,.nw-journal-list,.nw-journal-detail)::-webkit-scrollbar-thumb{
  background:color-mix(in srgb, var(--nw-line-strong) 70%, transparent);
  border-radius:var(--nw-r-pill);
}
.nw-root :where(.nw-modal-body,.nw-suggest-list,.nw-diff,.nw-version-list,
  .nw-preview-text,.nw-journal-list,.nw-journal-detail)::-webkit-scrollbar-thumb:hover{
  background:var(--nw-fg-soft);
}

@media (prefers-reduced-motion: reduce){
  .nw-root *,.nw-root *::before,.nw-root *::after{
    animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important;scroll-behavior:auto !important;
  }
}
`);

  // ------------------------------- shell frame -------------------------------
  NW.Shell = function Shell(props) {
    return h('div', { className: 'nw-root' }, props.children);
  };

  NW.StatusBar = function StatusBar(props) {
    const s = props || {};
    return h(
      'div',
      { className: 'nw-status', role: 'status', 'aria-live': 'polite' },
      h('span', null, h('i', { className: 'nw-dot', 'data-state': s.saveState || 'idle' }), s.saveText || ''),
      h('span', { className: 'nw-spacer', style: { flex: 1 } }),
      s.middle || null,
      h('span', null, s.syncText || ''),
      h('span', null, s.wordText || ''),
      h('span', null, s.counterText || ''),
    );
  };

  /** Draggable vertical splitter between the shelf and the editor. */
  NW.Splitter = function Splitter(props) {
    const onWidth = props.onWidth || (() => {});
    const min = props.min ?? 180;
    const max = props.max ?? 720;
    const ref = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    const container = () => (ref.current && ref.current.parentElement) || null;
    React.useEffect(() => {
      if (!dragging) return undefined;
      const move = (ev) => {
        const box = container();
        if (!box) return;
        const rect = box.getBoundingClientRect();
        const raw = ev.clientX - rect.left;
        const next = Math.max(min, Math.min(max, raw));
        onWidth(Math.round(next));
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
    }, [dragging, min, max, onWidth]);
    return h('div', {
      ref,
      className: 'nw-splitter',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': '调整目录宽度',
      'data-drag': dragging ? '1' : '0',
      tabIndex: 0,
      title: '拖拽调整目录宽度（双击重置）',
      onPointerDown: (ev) => {
        ev.preventDefault();
        setDragging(true);
      },
      onDoubleClick: () => onWidth(props.resetWidth ?? 272),
      onKeyDown: (ev) => {
        if (ev.key === 'ArrowLeft') onWidth(Math.max(min, (props.width ?? 272) - 16));
        if (ev.key === 'ArrowRight') onWidth(Math.min(max, (props.width ?? 272) + 16));
      },
    });
  };
})();
