;(() => {
  'use strict';

  // ============================================================================
  // 精神空间 · 正文编辑器  (NW.Editor)
  //
  // DOM layering (all inside one scrolling column, page is centred):
  //
  //   .nw-surface[data-theme]                 reading palette + CSS vars
  //     .nw-scroll                            the ONLY vertical scroller
  //       .nw-page (max width = --nw-width)   padding top/bottom = 留白
  //         .nw-stack (position:relative)
  //           .nw-hl        z-index:var(--nw-z-base)  typography mirror, color:transparent,
  //                                     draws <mark> highlights (pointer-events:none)
  //           .nw-caret     z-index:var(--nw-z-base)  visibility:hidden measuring mirror used to
  //                                     locate the caret's *visual* line
  //           textarea      z-index:var(--nw-z-base)  transparent, uncontrolled, grown to the
  //                                     full content height (so it never scrolls
  //                                     internally and both mirrors stay aligned)
  //     .nw-findbar (absolute)                find & replace overlay
  //
  // Why the textarea is grown instead of scrolling: the typewriter target is
  // computed as
  //     scrollTop = textarea.offsetTop(in scroller)
  //               + caretLineTop(measured by the mirror)
  //               + lineHeight / 2 - viewportHeight / 2
  // which is exact only when the textarea's text starts at its own top edge and
  // the outer column is what moves. `lineHeight * newlineCount` is never used:
  // automatic wrapping makes that wrong.
  // ============================================================================

  const DEFAULT_FONT = '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';
  /** Dock clearance rule (CONTRACT-R3 section 7): blank right of the text. */
  const DOCK_CLEAR_PX = 88;
  /**
   * Extra lane kept for the 灵感便签 column (R10). Pinned to the same right edge
   * as the dock, the notes panel is 196px + 8px offset wide, so the text column
   * must clear ~212px or a floating note would sit on top of the manuscript.
   * The toolbar and the status bar are gone in immersive mode, so the rule only
   * applies to the normal writing layout.
   */
  const NOTES_CLEAR_PX = 212;
  const TYPEWRITER_RESUME_MS = 800; // manual scroll keeps typewriter off this long
  const MEASURE_MS = 60; // caret measurement / autosize throttle
  const TAB_TEXT = '\u3000\u3000'; // two full-width spaces
  const MAX_MATCHES = 5000;
  // Reading palettes owned by the editor. The five ids are shared with the
  // shell (client/src/98-shell-theme.js) and with settings.theme. R19 dropped
  // harness / ink / card / guofeng — see the palette comment further down.
  const THEMES = { claude: 1, eye: 1, night: 1, newspaper: 1, magazine: 1 };
  // Values written by older settings rows keep working: the shell migrates
  // them in 90-app, but the editor has to tolerate a stale settings object too
  // (a document opened from an older backup, a settings write that raced).
  // Every retired id lands on its closest surviving neighbour so an old row
  // never falls through to an unstyled surface.
  const THEME_ALIAS = {
    light: 'claude',
    paper: 'claude',
    harness: 'claude',
    card: 'claude',
    dark: 'night',
    parchment: 'night',
    ink: 'night',
    guofeng: 'newspaper',
    eye: 'eye',
  };

  // ---------------------------------------------------------------- helpers --
  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function numOf(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampNum(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /**
   * Titles the editor must not print above the text.
   *
   * Mirrors `isPlaceholderTitle()` in `lib/routes.js`: chapters created with
   * the toolbar are all called "新章节", so a short story written in one of
   * them would otherwise open with a machine-generated heading. A real title
   * ("第一章 起" / "雪夜") still shows.
   */
  const PLACEHOLDER_TITLES = {
    '新章节': true,
    '未命名': true,
    '未命名章节': true,
    '正文': true,
    '无题': true,
    '内容': true,
  };
  const PLACEHOLDER_RE = /^(?:新章节|未命名章节?)\s*\d*$|^第\s*[0-9零一二三四五六七八九十百]+\s*[章节回卷幕]$/;

  function isPlaceholderTitle(title) {
    const text = String(title == null ? '' : title).trim();
    if (!text) return true;
    if (PLACEHOLDER_TITLES[text]) return true;
    return PLACEHOLDER_RE.test(text);
  }

  function fontStackOf(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return DEFAULT_FONT;
    // Already a font stack / quoted name: respect it verbatim.
    if (/[,"']/.test(raw)) return raw;
    return '"' + raw.replace(/"/g, '') + '","Songti SC","SimSun",serif';
  }

  function themeOf(value) {
    const key = String(value || '').toLowerCase();
    if (THEMES[key]) return key;
    const alias = THEME_ALIAS[key];
    return alias || 'claude';
  }

  function countWordsOf(text) {
    const value = typeof text === 'string' ? text : '';
    const f = NW.format;
    if (f && typeof f.wordCount === 'function') {
      try {
        const n = f.wordCount(value);
        if (Number.isFinite(n)) return n;
      } catch (err) {
        /* fall through to the cheap counter */
      }
    }
    return value.length;
  }

  function lineColOf(text, offset) {
    const value = typeof text === 'string' ? text : '';
    const at = clampNum(Math.round(numOf(offset, 0)), 0, value.length);
    const upto = value.slice(0, at);
    const lastBreak = upto.lastIndexOf('\n');
    let line = 1;
    for (let i = 0; i < upto.length; i += 1) {
      if (upto.charCodeAt(i) === 10) line += 1;
    }
    return { line, col: lastBreak < 0 ? at + 1 : at - lastBreak };
  }

  function collectMatches(text, query) {
    const out = [];
    if (!text || !query) return out;
    const hay = String(text).toLowerCase();
    const needle = String(query).toLowerCase();
    if (!needle) return out;
    let from = 0;
    while (out.length < MAX_MATCHES) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      out.push({ start: at, end: at + needle.length });
      from = at + needle.length;
    }
    return out;
  }

  function clearNode(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  /** Button that prefers `NW.ui.btn` but always renders something usable. */
  function mkBtn(opts) {
    const o = opts || {};
    const ui = NW.ui;
    if (ui && typeof ui.btn === 'function') {
      try {
        return ui.btn({
          children: o.children,
          onClick: o.onClick,
          kind: o.kind,
          title: o.title,
          disabled: o.disabled,
          active: o.active,
        });
      } catch (err) {
        /* fall through to the local button */
      }
    }
    return h(
      'button',
      {
        type: 'button',
        className: 'nw-ebtn' + (o.kind === 'primary' ? ' is-primary' : ''),
        title: o.title,
        'aria-label': o.ariaLabel || o.title,
        disabled: !!o.disabled,
        onClick: o.onClick,
      },
      o.children,
    );
  }

  // -------------------------------------------------------------------- CSS --
  NW.CSS_PARTS.push(`
.nw-surface{
  position:relative;display:flex;flex-direction:column;flex:1 1 auto;
  height:100%;min-height:0;min-width:0;overflow:hidden;
  background:var(--nw-bg);color:var(--nw-fg);
  /* R6: paper grain. A palette may set --nw-texture; every shipped palette
     leaves it unset (backgrounds are plain colour since R10 ⑧), so this
     resolves to none. The hook stays for user themes. */
  background-image:var(--nw-texture,none);
  font-family:var(--nw-ui-font,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);
  font-size:16px;line-height:1.6;
  transition:background-color var(--nw-dur) var(--nw-ease, cubic-bezier(.2,.7,.2,1)),
             color var(--nw-dur) var(--nw-ease, cubic-bezier(.2,.7,.2,1));
  /* Reading measure. --nw-pad-x is the fixed gutter of the writing column;
     --nw-gutter-x is the extra lane kept free for the floating dock pinned to
     the bottom-right of the pane (CONTRACT-R3 section 7: the text's right edge
     never comes within 88px of the pane's right edge).
     48 + 40 = 88 satisfies that at this baseline. The lane is symmetric so the
     text block stays optically centred on the page instead of leaning away
     from the dock; refresh() raises it only when the pane gets narrow enough
     that the page's own side margin stops providing the clearance. */
  --nw-pad-x:48px;--nw-pad-y:56px;--nw-gutter-x:40px;
  /* R3 asks for a noticeably thick, near-black caret: 3px reads as a bar at
     any zoom, and the RGB triplet is real ink rather than a grey. The palette
     blocks below still override the colour per theme (warm ink on paper,
     near-white on the night surface). */
  --nw-caret-width:3px;--nw-caret-color:#0f0f0e;
}
/* Small panes: the gutter shrinks, the 88px rule does not (22 + 66 = 88).
   R13: keyed off the plugin's column (container "nw" in 05-css), not the
   window — a 700px-wide editor inside a 1440px window still wants the tight
   gutter. */
@container nw (max-width: 720px){.nw-surface{--nw-pad-x:22px;--nw-pad-y:36px;--nw-gutter-x:66px;}}

.nw-surface[data-theme="claude"]{
  --nw-bg:#faf4e9;--nw-fg:#1b1813;--nw-soft:#6d6558;--nw-rule:#e6dccb;
  --nw-caret-color:#1b1813;--nw-caret:#1b1813;--nw-sel:rgba(27,24,19,.14);
  --nw-accent:#c4532f;
  --nw-scroll-thumb:rgba(27,24,19,.18);--nw-scroll-thumb-hover:rgba(27,24,19,.32);
  --nw-panel:#fdf8ef;--nw-panel-border:#e6dccb;--nw-panel-shadow:0 8px 24px rgba(64,44,24,.09);
  --nw-btn-bg:#f3ecdf;--nw-btn-fg:#1b1813;--nw-btn-border:#e6dccb;--nw-btn-hover:#eae1d1;
  --nw-hl-bg:rgba(196,83,47,.20);--nw-hl-line:rgba(170,66,36,.60);--nw-hl-active:rgba(196,83,47,.36);
  --nw-find-bg:rgba(196,83,47,.13);--nw-find-active:rgba(196,83,47,.28);--nw-find-ring:rgba(170,66,36,.82);
  --nw-empty-glyph:rgba(27,24,19,.16);
  /* A warm vertical wash: the page is lit from the top like a sheet on a desk. */
  --nw-texture:none;
  /* The floating dock sits over the bottom-right of .nw-main; keep the right
     gutter wide enough that no glyph can hide underneath it. */
  --nw-gutter-x:40px;
}
.nw-surface[data-theme="eye"]{
  --nw-bg:#cce8cf;--nw-fg:#1f2a20;--nw-soft:#55684f;--nw-rule:#b6d6ba;
  --nw-caret-color:#1f2a20;--nw-caret:#1f2a20;--nw-sel:rgba(31,42,32,.18);
  --nw-accent:#2f6b3c;
  --nw-scroll-thumb:rgba(31,42,32,.22);--nw-scroll-thumb-hover:rgba(31,42,32,.36);
  --nw-panel:#ddf1de;--nw-panel-border:#b6d6ba;--nw-panel-shadow:0 8px 24px rgba(31,42,32,.14);
  --nw-btn-bg:#c1e0c5;--nw-btn-fg:#1f2a20;--nw-btn-border:#a9cbaa;--nw-btn-hover:#b3d8b8;
  --nw-hl-bg:rgba(255,214,0,.32);--nw-hl-line:rgba(158,116,0,.62);--nw-hl-active:rgba(255,170,0,.44);
  --nw-find-bg:rgba(31,42,32,.12);--nw-find-active:rgba(31,42,32,.26);--nw-find-ring:rgba(31,42,32,.76);
  --nw-empty-glyph:rgba(31,42,32,.18);
  --nw-texture:none;
}
.nw-surface[data-theme="night"]{
  --nw-bg:#1a1a18;--nw-fg:#e8e6dc;--nw-soft:#9c9a90;--nw-rule:#33322d;
  --nw-caret-color:#e8e6dc;--nw-caret:#e8e6dc;--nw-sel:rgba(232,230,220,.18);
  --nw-accent:#e08d6f;
  --nw-scroll-thumb:rgba(232,230,220,.18);--nw-scroll-thumb-hover:rgba(232,230,220,.34);
  --nw-panel:#221f1d;--nw-panel-border:#33322d;--nw-panel-shadow:0 8px 24px rgba(0,0,0,.46);
  --nw-btn-bg:#2a2825;--nw-btn-fg:#e8e6dc;--nw-btn-border:#3a3832;--nw-btn-hover:#35322e;
  --nw-hl-bg:rgba(224,141,111,.24);--nw-hl-line:rgba(224,141,111,.62);--nw-hl-active:rgba(224,141,111,.40);
  --nw-find-bg:rgba(224,141,111,.16);--nw-find-active:rgba(224,141,111,.32);--nw-find-ring:rgba(224,141,111,.86);
  --nw-empty-glyph:rgba(232,230,220,.16);
  --nw-texture:none;
}
/* newspaper — 报纸：新闻纸米黄底、全衬线、细墨线，标题用报头红。 */
.nw-surface[data-theme="newspaper"]{
  --nw-bg:#ecdfbe;--nw-fg:#1a1913;--nw-soft:#5a5546;--nw-rule:#d3c8a9;
  --nw-caret-color:#1a1913;--nw-caret:#1a1913;--nw-sel:rgba(26,25,19,.16);
  --nw-accent:#8c2b22;
  --nw-scroll-thumb:rgba(26,25,19,.20);--nw-scroll-thumb-hover:rgba(26,25,19,.36);
  --nw-panel:#f4ecd6;--nw-panel-border:#d9cfae;--nw-panel-shadow:0 8px 22px rgba(80,64,32,.14);
  --nw-btn-bg:#e4d7b4;--nw-btn-fg:#2a271e;--nw-btn-border:#d3c8a9;--nw-btn-hover:#dbcca6;
  --nw-hl-bg:rgba(140,43,34,.18);--nw-hl-line:rgba(140,43,34,.56);--nw-hl-active:rgba(140,43,34,.32);
  --nw-find-bg:rgba(26,25,19,.10);--nw-find-active:rgba(26,25,19,.24);--nw-find-ring:rgba(26,25,19,.72);
  --nw-empty-glyph:rgba(26,25,19,.16);
  /* A newspaper has no rounded corners anywhere. */
  --nw-r-card:2px;--nw-r-control:2px;--nw-r-modal:3px;--nw-r-pill:2px;
  --nw-ui-font-override:Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif;
  --nw-reading-font:Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif;
  /* R10: solid paper. The old ruled newsprint used a repeating-linear-gradient
     per 3px, which users read as "background grid" — replaced by a flat tone. */
  --nw-texture:none;
}

/* magazine — 杂志 (R10): glossy white stock, sans-serif UI, a saturated
   editorial red for rules and highlights, generous leading. It is the only
   theme that is deliberately *not* bookish: a magazine page is a designed
   surface, so the accent colour carries more weight than the paper.
   The paper stays a flat colour — no gradient, no texture. */
.nw-surface[data-theme="magazine"]{
  --nw-bg:#ffffff;--nw-fg:#14171a;--nw-soft:#6a7078;--nw-rule:#e6e8eb;
  --nw-caret-color:#14171a;--nw-caret:#14171a;--nw-sel:rgba(20,23,26,.14);
  --nw-accent:#d0021b;
  --nw-scroll-thumb:rgba(20,23,26,.16);--nw-scroll-thumb-hover:rgba(20,23,26,.30);
  --nw-panel:#ffffff;--nw-panel-border:#e6e8eb;--nw-panel-shadow:0 10px 30px rgba(20,23,26,.08);
  --nw-btn-bg:#fafafa;--nw-btn-fg:#14171a;--nw-btn-border:#e6e8eb;--nw-btn-hover:#f1f2f3;
  --nw-hl-bg:rgba(208,2,27,.14);--nw-hl-line:rgba(208,2,27,.58);--nw-hl-active:rgba(208,2,27,.28);
  --nw-find-bg:rgba(208,2,27,.12);--nw-find-active:rgba(208,2,27,.24);--nw-find-ring:rgba(208,2,27,.80);
  --nw-empty-glyph:rgba(20,23,26,.12);
  --nw-r-card:14px;--nw-r-control:10px;
  --nw-ui-font-override:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --nw-reading-font:"Source Han Serif SC","Noto Serif SC","Songti SC","Times New Roman",serif;
  --nw-texture:none;
}

/* Immersive writing surface (prop "immersive"). The component raises --nw-width
   to at least 880px; its 96px gutters are generous enough on their own, and the
   dock is dimmed and deprioritised in immersive mode, so the extra lane is
   dropped. This block sits AFTER the theme palettes on purpose: the claude
   palette also declares --nw-gutter-x and both selectors have the same
   specificity, so source order is what decides the winner. */
.nw-surface[data-immersive="1"]{--nw-pad-x:96px;--nw-pad-y:96px;--nw-gutter-x:0px;}
@container nw (max-width: 720px){.nw-surface[data-immersive="1"]{--nw-pad-x:40px;--nw-pad-y:48px;--nw-gutter-x:48px;}}

/* ---- scroller + page ---- */
.nw-scroll{
  position:relative;flex:1 1 auto;min-height:0;
  overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  scrollbar-width:thin;scrollbar-color:var(--nw-scroll-thumb) transparent;
}
.nw-scroll::-webkit-scrollbar{width:8px;height:8px;}
.nw-scroll::-webkit-scrollbar-track{background:transparent;}
.nw-scroll::-webkit-scrollbar-thumb{
  background:var(--nw-scroll-thumb);border-radius:var(--nw-r-control);border:2px solid transparent;background-clip:padding-box;
}
.nw-scroll::-webkit-scrollbar-thumb:hover{background:var(--nw-scroll-thumb-hover);background-clip:padding-box;}
/* ---- the sheet ------------------------------------------------------------
   R19 B6: the manuscript used to be a bare rectangle of paper colour, which on
   a wide panel read as "a textarea", not "a page". A hairline plus one soft
   drop is enough to lift it off the desk; anything stronger turns the writing
   surface into a card and competes with the text. The shadow is only drawn
   when the sheet is actually narrower than the pane — at 100% width it would
   be clipped by .nw-scroll and leave a smudge on one edge only. */
.nw-page{
  width:min(var(--nw-width,760px),100%);margin:0 auto;padding:var(--nw-pad-y) 0;
  border-radius:var(--nw-r-card);
  transition:box-shadow var(--nw-dur) var(--nw-ease,ease);
}
@container nw (min-width: 780px){
  .nw-page{
    /* R21: the sheet needs its own fill, not just a border and a shadow. It was
       transparent, so the drop shadow had nothing to sit under and the "paper"
       read as a flat patch the same colour as the desk around it — the lift was
       invisible. --nw-panel is the palette's one step above the surface, which
       is exactly the difference a sheet of paper has against a desk. */
    background:var(--nw-panel);
    border:1px solid var(--nw-line-soft);
    box-shadow:var(--nw-shadow-paper);
  }
}
/* Typewriter room. Centring the caret needs half a viewport of content above
   the first line and below the last one; without it the scrollTop gets clamped
   at 0/max near the document edges and the line never reaches the middle —
   which is exactly where people type most of the time. --nw-tw-room is set by
   the component to max(0, viewport/2 - lineHeight) while typewriter is on. */
.nw-surface[data-typewriter="1"] .nw-page{
  padding-top:calc(var(--nw-pad-y) + var(--nw-tw-room,0px));
  padding-bottom:calc(var(--nw-pad-y) + var(--nw-tw-room,0px));
}
.nw-stack{position:relative;width:100%;contain:layout style;}

/* ---- chapter heading (R17 ①, reworked R19) -------------------------------
   The chapter name is printed as the first line of the manuscript, centred and
   larger than the body. It lives inside .nw-page above .nw-stack so it scrolls
   with the text, and it is deliberately NOT part of the textarea: the writer
   renames it in the shelf, the editor only displays it. Its height is measured
   by chapterTitleH() and subtracted from the typewriter room.

   R19: this used to be 700-weight, which read like a government notice. A book
   heading is quieter than the body, not louder: semibold, a hair of tracking,
   and a short centred rule that spans the title only. The rule is a pseudo
   element, not a border on the block, so it never stretches the full measure. */
.nw-chaptertitle{
  display:block;
  padding:0 calc(var(--nw-pad-x) + var(--nw-gutter-x,0px));
  margin:0 0 calc(var(--nw-line) * 0.9em);
  font-family:var(--nw-font);
  font-size:calc(var(--nw-size) * 1.22);
  font-weight:600;
  line-height:1.5;
  letter-spacing:.02em;
  text-align:center;
  color:var(--nw-fg);
  overflow-wrap:break-word;word-break:break-word;
  user-select:none;
}
.nw-chaptertitle::after{
  content:'';
  display:block;
  width:36px;height:1px;
  margin:calc(var(--nw-line) * 0.55em) auto 0;
  background:var(--nw-rule);
  opacity:.8;
}
.nw-surface[data-immersive="1"] .nw-chaptertitle::after{opacity:.55;}

/* ---- shared typography for the textarea and BOTH mirrors -----------------
   Every wrapping-affecting property must be identical or the caret/highlight
   mirrors would disagree with the textarea. The extra right gutter keeps the
   last glyph of every line clear of the floating dock pinned to the bottom
   right of the writing pane (CONTRACT-R3 section 7). */
.nw-ta,.nw-hl,.nw-caret{
  box-sizing:border-box;display:block;width:100%;margin:0;border:0;
  padding:0 calc(var(--nw-pad-x) + var(--nw-gutter-x,0px));
  font-family:var(--nw-font);font-size:var(--nw-size);font-weight:400;font-style:normal;
  line-height:var(--nw-line);letter-spacing:0;word-spacing:0;text-align:left;text-indent:0;
  text-transform:none;font-variant-ligatures:none;
  white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;tab-size:4;
  direction:ltr;unicode-bidi:normal;
}

/* The native caret is 1px and nearly invisible on the warm paper themes, so it
   is hidden and replaced by .nw-cursor below, positioned from the very same
   mirror measurement the typewriter uses (no second geometry pipeline). */
.nw-ta{
  position:relative;z-index:var(--nw-z-base);
  background:transparent;color:var(--nw-fg);caret-color:transparent;
  overflow:hidden;resize:none;outline:none;-webkit-appearance:none;appearance:none;
  border-radius:0;
}
.nw-ta:focus{outline:none;}
.nw-ta::selection{background:var(--nw-sel);color:var(--nw-fg);}
.nw-ta::-moz-selection{background:var(--nw-sel);color:var(--nw-fg);}
.nw-surface ::selection{background:var(--nw-sel);color:inherit;}

/* Thick caret. Absolutely positioned inside .nw-stack; its transform is written
   from measureCaret() so it tracks wrapped lines exactly. Two identical blink
   animations let the paint code restart the blink by swapping animation-name
   (a keystroke makes the caret solid again) without forcing a reflow. */
.nw-cursor{
  position:absolute;left:0;top:0;width:var(--nw-caret-width,2px);height:1.2em;
  background:var(--nw-caret-color,#141413);border-radius:1px;
  pointer-events:none;user-select:none;z-index:var(--nw-z-float);display:none;
  animation:nw-caret-blink 1.06s step-end infinite;
}
/* R11: "光标闪烁" is a setting. paintCaret swaps animation-name to restart the
   blink, which would silently switch it back on, so the off state is enforced
   with !important on the surface attribute rather than by an inline style. */
.nw-surface[data-caret-blink="0"] .nw-cursor{animation:none !important;}
.nw-cursor[data-visible="1"]{display:block;}
@keyframes nw-caret-blink{0%,49.99%{opacity:1;}50%,100%{opacity:0;}}
@keyframes nw-caret-blink-b{0%,49.99%{opacity:1;}50%,100%{opacity:0;}}
@media (prefers-reduced-motion: reduce){
  .nw-cursor{animation:none;}
}

/* highlight mirror: sits behind the transparent textarea, draws marks only */
.nw-hl{
  position:absolute;left:0;top:0;right:0;height:100%;overflow:hidden;
  color:transparent;pointer-events:none;user-select:none;z-index:var(--nw-z-base);
}
.nw-hl mark{color:transparent;background-color:transparent;}
.nw-hl .nw-hl-mark{background-color:var(--nw-hl-bg);border-radius:var(--nw-r-hair);box-shadow:inset 0 -1.5px 0 var(--nw-hl-line);}
.nw-hl .nw-hl-mark[data-active="1"]{background-color:var(--nw-hl-active);}
/* R23: the sentence the advice panel is talking about gets a solid underline.
   The fill drops to a hint of tint so the words stay legible (the writer is
   comparing them with the suggestion, not looking at a highlight) and the rule
   itself carries the emphasis — the same brand-coloured underline the quote
   wears inside the advice card. */
.nw-hl .nw-hl-mark[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-hl-active) 30%, transparent);
  box-shadow:inset 0 -2px 0 var(--nw-brand);
}
.nw-hl .nw-find-hit{background-color:var(--nw-find-bg);border-radius:var(--nw-r-hair);}
.nw-hl .nw-find-hit[data-active="1"]{background-color:var(--nw-find-active);box-shadow:inset 0 0 0 1px var(--nw-find-ring);}

/* caret measuring mirror: same box, never painted */
.nw-caret{
  position:absolute;left:0;top:0;width:100%;height:auto;overflow:visible;
  visibility:hidden;pointer-events:none;user-select:none;z-index:var(--nw-z-base);
}
/* zero-size inline-block anchored to the line box top, not to the baseline */
.nw-caret-mark{display:inline-block;width:0;height:0;vertical-align:top;overflow:hidden;}

/* ---- empty state ---- */
.nw-empty{
  min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--nw-sp-2);padding:var(--nw-sp-6);text-align:center;color:var(--nw-soft);
}
.nw-empty .nw-empty-glyph{font-size:40px;line-height:1;color:var(--nw-empty-glyph);}
.nw-empty .nw-empty-main{font-size:14px;}
.nw-empty .nw-empty-sub{font-size:var(--nw-fs-tiny);opacity:.8;}

/* ---- find & replace overlay ---- */
.nw-findbar{
  position:absolute;top:10px;right:14px;z-index:var(--nw-z-float);
  width:min(342px,calc(100% - 28px));display:flex;flex-direction:column;gap:var(--nw-sp-0);
  padding:var(--nw-sp-1);border-radius:var(--nw-r-card);
  background:var(--nw-panel);border:1px solid var(--nw-panel-border);box-shadow:var(--nw-panel-shadow);
  color:var(--nw-btn-fg);font-size:12px;
}
/* 首页 / 目录 / 锁定 — the corner controls of the writing surface.
   R16: the home button lost its label and this row also hosts the shelf handle
   and the lock button, so the writer never has to reach into DSH chrome (in
   immersive mode there is no toolbar at all, and a collapsed shelf would
   otherwise be unrecoverable from this view). */
.nw-surface-acts{
  position:absolute;top:10px;left:14px;z-index:var(--nw-z-float);
  display:inline-flex;align-items:center;gap:4px;
}
.nw-homebtn,
.nw-actbtn{
  display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:0;
  border-radius:var(--nw-r-control);border:1px solid var(--nw-btn-border);
  background:var(--nw-panel);color:var(--nw-btn-fg);
  font-family:inherit;font-size:12px;line-height:1;cursor:pointer;
  /* R21: 0.55 was meant as "quiet until hovered", but on the warm palettes it
     reads as disabled — the glyph sits at ~45% contrast against the paper and
     the writer has to hunt for it. 0.78 is still clearly secondary next to the
     body text while staying legible; hover takes it to 1. */
  opacity:.78;transition:opacity var(--nw-dur) ease,background var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-homebtn:hover,
.nw-actbtn:hover{opacity:1;background:var(--nw-btn-hover);border-color:var(--nw-find-ring);}
.nw-homebtn:focus-visible,
.nw-actbtn:focus-visible{opacity:1;outline:2px solid var(--nw-find-ring);outline-offset:2px;}
/* The icon component owns its own size (42-icons snaps every request to one
   ladder), so the corner buttons must not re-scale the svg here — doing both
   was how neighbouring icons ended up 14/15/16px in the same row. */
.nw-homebtn > svg,
.nw-actbtn > svg{flex:0 0 auto;}
.nw-surface[data-immersive="1"] .nw-homebtn,
.nw-surface[data-immersive="1"] .nw-actbtn{opacity:.28;}
.nw-surface[data-immersive="1"] .nw-homebtn:hover,
.nw-surface[data-immersive="1"] .nw-actbtn:hover{opacity:1;}
.nw-findbar .nw-find-row{display:flex;align-items:center;gap:var(--nw-sp-0);}
.nw-findbar .nw-find-input{
  flex:1 1 auto;min-width:0;height:27px;padding:0 8px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-btn-border);background:var(--nw-bg);color:var(--nw-fg);
  font-family:inherit;font-size:12px;line-height:25px;outline:none;
}
.nw-findbar .nw-find-input::placeholder{color:var(--nw-soft);}
.nw-findbar .nw-find-input:focus{border-color:var(--nw-find-ring);box-shadow:0 0 0 2px var(--nw-find-bg);}
.nw-findbar .nw-find-count{
  min-width:52px;text-align:right;color:var(--nw-soft);font-size:var(--nw-fs-tiny);
  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-findbar .nw-find-actions{display:flex;align-items:center;gap:var(--nw-sp-0);flex-wrap:wrap;}
.nw-findbar .nw-find-spacer{flex:1 1 auto;min-width:4px;}

.nw-ebtn{
  -webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;justify-content:center;
  height:27px;padding:0 9px;border-radius:var(--nw-r-control);border:1px solid var(--nw-btn-border);
  background:var(--nw-btn-bg);color:var(--nw-btn-fg);
  font-family:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;
  transition:background-color var(--nw-dur) ease,border-color var(--nw-dur) ease,opacity var(--nw-dur) ease;
}
.nw-ebtn:hover:not([disabled]){background:var(--nw-btn-hover);}
.nw-ebtn:active:not([disabled]){transform:translateY(.5px);}
.nw-ebtn[disabled]{opacity:.45;cursor:default;}
`);

  // =========================================================== the component ==
  NW.Editor = function Editor(props) {
    const p = props || {};
    const settings = p.settings || {};

    const fontFamily = fontStackOf(settings.fontFamily);
    // Fallbacks mirror DEFAULT_SETTINGS in 10-db.js so a chapter rendered
    // before the settings row loads still gets the intended Claude typography
    // (20px / 2.0 / 760px measure).
    const fontSize = clampNum(numOf(settings.fontSize, 20), 11, 42);
    const lineHeight = clampNum(numOf(settings.lineHeight, 2), 1.1, 3.4);
    const pageWidth = clampNum(numOf(settings.pageWidth, 760), 360, 1400);
    const theme = themeOf(settings.theme);
    const autoSaveMs = clampNum(numOf(settings.autoSaveMs, 1200), 200, 60000);
    const typewriterOn = settings.typewriter !== false;
    // Immersive writing surface: explicit prop wins, settings.immersive is the
    // fallback (the app ships it in DEFAULT_SETTINGS but does not pass the prop).
    const immersive = p.immersive === true || (p.immersive !== false && settings.immersive === true);
    // R12 ①: the writing surface needs its own way home — the toolbar has no
    // back button, and in immersive mode there is no toolbar at all.
    const onHome = typeof p.onHome === 'function' ? p.onHome : null;
    // R16 ③: the shelf handle and the lock button live next to the home button
    // so the writing surface keeps its own controls even when DSH chrome is
    // hidden (immersive) or the shelf is collapsed.
    const onToggleShelf = typeof p.onToggleShelf === 'function' ? p.onToggleShelf : null;
    const onLock = typeof p.onLock === 'function' ? p.onLock : null;
    // Which glyph the shelf handle shows: a collapsed shelf needs 展开, an open
    // one 收起. The app passes `shelfOpen` so the button never lies.
    const shelfOpen = p.shelfOpen !== false;
    // R22: keyboard shortcuts for the two most common structural actions. The
    // editor owns the keystrokes because it has focus; the app owns the actions.
    const onNewChapter = typeof p.onNewChapter === 'function' ? p.onNewChapter : null;
    const onToggleAdvice = typeof p.onToggleAdvice === 'function' ? p.onToggleAdvice : null;
    /** 灵感便签 lane (R10): the app mounts the notes column beside the text. */
    const notesLane = p.notesLane === true && !immersive;
    /** Page width actually applied; immersive mode guarantees a wide canvas. */
    const effPageWidth = immersive ? Math.max(pageWidth, 880) : pageWidth;

    const chapter = p.chapter || null;
    const chapterId = chapter && chapter.id != null ? chapter.id : null;

    // R17 ①: the chapter name is printed as the first line of the manuscript,
    // centred and larger than the body. Placeholder titles ("新章节" and the
    // like) are hidden — a short story written in the auto-created chapter
    // should read as one continuous text, not as a machine-generated heading.
    // Declared here (not next to the JSX) because the measuring effects below
    // depend on it.
    const chapterTitle = chapter ? String(chapter.title || '').trim() : '';
    const showTitle = Boolean(chapterTitle) && !isPlaceholderTitle(chapterTitle);

    // ---- caret appearance (R11): width / colour / blink are user settings ----
    // The palette still owns `--nw-caret-color` per theme, so an empty
    // `settings.caretColor` means "follow the theme"; anything else overrides it.
    const caretWidth = clampNum(numOf(settings.caretWidth, 3), 1, 8);
    const caretColor = String(settings.caretColor == null ? '' : settings.caretColor).trim();
    const caretBlink = settings.caretBlink !== false;

    const surfaceStyle = {
      '--nw-font': fontFamily,
      '--nw-size': fontSize + 'px',
      '--nw-line': String(lineHeight),
      '--nw-width': effPageWidth + 'px',
      '--nw-caret-width': caretWidth + 'px',
    };
    if (caretColor) surfaceStyle['--nw-caret-color'] = caretColor;

    // ---- refs (native listeners + api read these, never stale closures) ----
    const taRef = React.useRef(null);
    const surfaceRef = React.useRef(null);
    const scrollRef = React.useRef(null);
    const pageRef = React.useRef(null);
    const titleRef = React.useRef(null);
    const stackRef = React.useRef(null);
    const hlRef = React.useRef(null);
    const caretRef = React.useRef(null);
    // The painted thick caret (positioned by paintCaret from measureCaret).
    const cursorRef = React.useRef(null);
    const findInputRef = React.useRef(null);
    const replaceInputRef = React.useRef(null);

    const propsRef = React.useRef(p);
    propsRef.current = p;
    const cfgRef = React.useRef(null);
    cfgRef.current = { autoSaveMs, typewriterOn, fontSize, lineHeight };

    const highlightsRef = React.useRef([]);
    const saveTimerRef = React.useRef(0);
    // rAF handle for the coalesced measure pass (0 = none queued).
    const measureRafRef = React.useRef(0);
    // Safety timer paired with the rAF handle: a throttled frame (hidden tab)
    // still measures within MEASURE_MS, and whichever fires first cancels the
    // other, so one burst of input produces exactly one pass.
    const measureTimerRef = React.useRef(0);
    const measureQueuedRef = React.useRef(false);
    const noticeTimerRef = React.useRef(0);
    const manualAtRef = React.useRef(-1e9);
    const expectedScrollTopRef = React.useRef(-1);
    // Cached result of resolveScroller(): the element that really scrolls.
    const scrollerRef = React.useRef(null);
    const scrollerKindRef = React.useRef('self');
    // The element the native scroll/wheel listeners are currently bound to.
    const boundScrollRef = React.useRef(null);
    // Handlers currently bound (created once by the listener effect).
    const scrollHooksRef = React.useRef(null);
    // ResizeObserver watching whichever element currently scrolls.
    const scrollObserverRef = React.useRef(null);
    // Environment signature of the last exact autosize() (viewport, line
    // height, padding, width) plus the last text length: together they decide
    // whether the cheap grow-only path is valid or the full measure is needed.
    const autosizeEnvRef = React.useRef('');
    const autosizeLenRef = React.useRef(-1);
    // The painted caret hides when the whole window loses focus (Alt+Tab) even
    // though the textarea may still be document.activeElement.
    const winFocusedRef = React.useRef(true);
    const chapterIdRef = React.useRef(null);
    const pendingCenterRef = React.useRef(false);
    const dirtyRef = React.useRef(false);
    const composingRef = React.useRef(false);
    const draggingRef = React.useRef(false);
    const valueRef = React.useRef(
      chapter && typeof chapter.content === 'string' ? chapter.content : '',
    );
    const lastSavedRef = React.useRef(valueRef.current);
    const findRef = React.useRef({
      open: false,
      query: '',
      replace: '',
      matches: [],
      index: 0,
      notice: '',
    });
    const apiRef = React.useRef(null);
    /** Last selection payload pushed to the app (dedupe guard). */
    const lastSelRef = React.useRef({ start: -1, end: -1, value: null });
    const [, forceFind] = React.useState(0);
    // Which element class actually scrolls the surface: 'self' | 'ancestor' |
    // 'document'. Mirrored into `data-scroller` for diagnosis; only changes
    // when the host layout changes, so it never re-renders while typing.
    const [scrollerKind, setScrollerKind] = React.useState('self');
    /** Right-hand blank currently reserved for the floating dock, in px. */
    const dockLaneRef = React.useRef(-1);

    function bumpFind() {
      forceFind((n) => n + 1);
    }

    // ------------------------------------------------------------- geometry --
    /**
     * Finds the element that *actually* scrolls the writing surface.
     *
     * In the shipped host the panel is a flex child with a fixed height, so in
     * theory `.nw-scroll` (overflow-y:auto, min-height:0) is the scroller and
     * this is a one-liner. In practice hosts embed the page in a slot whose
     * height is auto, which makes `.nw-scroll` grow instead of scroll — the
     * wheel then scrolls the nearest ancestor (a shell pane) or the document.
     * Typewriter mode silently did nothing there because all scroll math was
     * pinned to `.nw-scroll`, whose scrollHeight===clientHeight.
     *
     * Order: own scroller → nearest scrollable ancestor → document scroller.
     * The result is cached in scrollerRef and re-resolved by syncScroller()
     * whenever layout can change (ResizeObserver, window resize, chapter swap).
     *
     * @param {boolean} [remeasure] true forces a fresh DOM walk
     * @returns {{el:Element, kind:string}} kind: 'self'|'ancestor'|'document'
     */
    function resolveScroller(remeasure) {
      const cached = scrollerRef.current;
      if (!remeasure && cached && cached.isConnected) {
        return { el: cached, kind: scrollerKindRef.current };
      }
      let el = null;
      let kind = 'self';
      const own = scrollRef.current;
      if (own) {
        // +2 absorbs sub-pixel rounding (zoom, fractional DPR).
        if (own.scrollHeight > own.clientHeight + 2) {
          el = own;
        } else {
          // Walk every ancestor up to (but excluding) the root element. `body`
          // is included on purpose: a host that puts overflow:auto there makes
          // it the real port, and skipping it would waste the walk. The root
          // (html) is covered by the scrollingElement fallback below.
          const root = (own.ownerDocument || document).documentElement;
          let node = own.parentElement;
          while (node && node !== root) {
            const oy = window.getComputedStyle(node).overflowY;
            const scrollable = oy === 'auto' || oy === 'scroll' || oy === 'overlay';
            if (scrollable && node.scrollHeight > node.clientHeight + 2) {
              el = node;
              kind = 'ancestor';
              break;
            }
            node = node.parentElement;
          }
        }
      }
      if (!el) {
        el = document.scrollingElement || document.documentElement;
        kind = 'document';
      }
      scrollerRef.current = el;
      scrollerKindRef.current = kind;
      return { el, kind };
    }

    /** Re-resolves the scroller and rebinds native listeners when it changed. */
    function syncScroller() {
      const prev = scrollerRef.current;
      const next = resolveScroller(true).el;
      if (surfaceRef.current) {
        const kind = scrollerKindRef.current;
        if (surfaceRef.current.getAttribute('data-scroller') !== kind) {
          surfaceRef.current.setAttribute('data-scroller', kind);
        }
      }
      if (prev !== next) {
        if (scrollHooksRef.current) bindScrollHooks();
        const observer = scrollObserverRef.current;
        if (observer && next) {
          try {
            observer.disconnect();
            observer.observe(next);
          } catch (err) {
            /* detached node */
          }
        }
        // Re-render once so the `data-scroller` attribute is in React's tree
        // too (otherwise React could later clobber it). Layout-only event.
        if (scrollerKind !== scrollerKindRef.current) setScrollerKind(scrollerKindRef.current);
      }
      return next;
    }

    /**
     * Re-resolves the scroller and asks for a re-measure, requesting a re-centre
     * only when the scrolling element's identity changed.
     *
     * A layout flip (host panel gains/loses its fixed height, immersive mode
     * hides a column, the window crosses its breakpoint) moves scrolling to a
     * different element. The old scrollTop means nothing for the new port, so
     * in typewriter mode the caret line can land far away from the middle and
     * stay there until the next keystroke — the "typewriter does nothing"
     * report, again. Re-centring here is safe: planCaretScroll() still refuses
     * while the user is dragging a selection or inside the manual-scroll window.
     *
     * The very first resolution (prev == null, mount) never centres: opening a
     * chapter must show it from the top, not jump to the middle.
     */
    function syncScrollerAndMeasure() {
      const prev = scrollerRef.current;
      const first = prev == null;
      syncScroller();
      const moved = !first && scrollerRef.current !== prev;
      // The dock lane depends on the pane geometry, which just changed.
      invalidateAutosize();
      const laneChanged = applyDockLane();
      // A lane change rewraps the column, so the caret line moved: re-centre.
      // On the very first resolution the chapter must still open at the top.
      scheduleMeasure(!first && (moved || laneChanged));
    }

    /** (Re)binds wheel/touchmove/scroll to the element that really scrolls. */
    function bindScrollHooks() {
      const hooks = scrollHooksRef.current;
      if (!hooks) return;
      const prev = boundScrollRef.current;
      if (prev) {
        prev.removeEventListener('wheel', hooks.wheel, { passive: true });
        prev.removeEventListener('touchmove', hooks.touchmove, { passive: true });
        prev.removeEventListener('scroll', hooks.scroll, { passive: true });
      }
      const next = scrollerRef.current;
      if (next) {
        next.addEventListener('wheel', hooks.wheel, { passive: true });
        next.addEventListener('touchmove', hooks.touchmove, { passive: true });
        next.addEventListener('scroll', hooks.scroll, { passive: true });
      }
      boundScrollRef.current = next;
    }

    function lineHeightPx() {
      const ta = taRef.current;
      const cfg = cfgRef.current || {};
      if (ta) {
        const cs = window.getComputedStyle(ta);
        const lh = parseFloat(cs.lineHeight);
        if (Number.isFinite(lh) && lh > 0) return lh;
        const fs = parseFloat(cs.fontSize);
        if (Number.isFinite(fs) && fs > 0) {
          return fs * numOf(cfg.lineHeight, 2);
        }
      }
      return numOf(cfg.fontSize, 20) * numOf(cfg.lineHeight, 2);
    }

    /**
     * Baseline vertical page padding (2 x --nw-pad-y), excluding the typewriter
     * room. Used for the textarea's minimum height so the writing surface keeps
     * filling the screen while typewriter mode is on.
     */
    function pageBasePadY() {
      const s = surfaceRef.current;
      let one = 56;
      if (s) {
        const n = parseFloat(window.getComputedStyle(s).getPropertyValue('--nw-pad-y'));
        if (Number.isFinite(n) && n >= 0) one = n;
      }
      return one * 2;
    }

    /**
     * Space the chapter heading takes above the first text line, in px.
     *
     * Measured from the heading itself (height + its bottom margin) rather than
     * from the page's top edge: the page padding already contains the typewriter
     * room, so deriving it that way would be circular. It is real content, so
     * both the room and the textarea's minimum height have to discount it —
     * otherwise the first line can never reach the middle and a short chapter
     * grows a scrollbar it does not need.
     */
    function chapterTitleH() {
      const el = titleRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.height) || rect.height <= 0) return 0;
      let marginBottom = 0;
      try {
        marginBottom = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
      } catch (ignored) {
        marginBottom = 0;
      }
      return rect.height + marginBottom;
    }

    /**
     * Blank scroll room needed above the first line and below the last one so
     * the caret line can reach the vertical middle anywhere in the document.
     *
     * Without it scrollTop clamps at 0 / maxScrollTop near the document edges
     * and typewriter mode visibly does nothing — which is precisely where a
     * writer spends most of their time (end of the chapter).
     */
    function typewriterRoom(view) {
      const cfg = cfgRef.current || {};
      if (cfg.typewriterOn === false) return 0;
      const v = view || resolveScroller(false);
      const sc = v && v.el;
      const viewH = (sc && sc.clientHeight) || window.innerHeight || 0;
      if (!viewH) return 0;
      const lh = lineHeightPx();
      // padTop (= padY + room + heading) must be >= viewH/2 - lh/2 for the first
      // line to reach the middle; +2px absorbs rounding.
      const head = chapterTitleH();
      return Math.max(0, Math.ceil(viewH / 2 - lh / 2 - pageBasePadY() / 2 - head) + 2);
    }

    /**
     * Cheap promotion from a fallback scroller back to `.nw-scroll`.
     *
     * resolveScroller() caches its answer and the cache cannot notice that the
     * writing column just grew taller than the panel: at that moment the DOM
     * element for `.nw-scroll` did not resize (its *content* did), so the
     * ResizeObserver stays silent. Without this check a fresh, short chapter
     * resolves to the document scroller and keeps it after the first wrapped
     * line — which is exactly when typewriter mode appears to do nothing.
     *
     * Cost: one scrollHeight read that the frame needs anyway; the full walk
     * only runs on the transition.
     */
    function upgradeScrollerIfNeeded() {
      if (scrollerKindRef.current === 'self') return;
      const own = scrollRef.current;
      if (!own || !own.isConnected) return;
      if (own.scrollHeight > own.clientHeight + 2) syncScroller();
    }

    /**
     * Reserves just enough right-hand blank to satisfy the dock rule.
     *
     * The floating dock is pinned to the bottom-right of the writing pane and
     * hovers over the surface, so the last glyph of any line must stay
     * DOCK_CLEAR_PX clear of the pane's right edge (CONTRACT-R3 section 7).
     * A centred narrow page usually leaves that much blank on its own; only
     * when the pane comes close to the page width does the text column have to
     * give up part of its measure. Deriving the lane from measured geometry
     * (rather than a media query) keeps it correct when the sidebar opens,
     * immersive mode hides chrome, or pageWidth changes in settings.
     *
     * Cost: two rect reads, and only on layout events (resize, scroller
     * identity change, typography change) — never from the typing path.
     *
     * @returns {boolean} true when the lane changed (re-wrap + re-measure)
     */
    function applyDockLane() {
      const s = surfaceRef.current;
      const page = pageRef.current;
      if (!s) return false;
      // Read "immersive" off the rendered attribute rather than the closure:
      // this function is also called from callbacks created on the first render
      // (ResizeObserver, the periodic recheck), and those would keep a stale
      // value after the user toggles immersive mode.
      const imm = s.getAttribute('data-immersive') === '1';
      // R10: the notes column shares the right edge with the dock. When it is
      // mounted (always, while a chapter is open and we are not immersive) the
      // clearance requirement jumps from 88px to 212px so a floating note never
      // covers a glyph. Read off the attribute for the same reason as `imm`:
      // this runs from timers created on the first render.
      const notes = s.getAttribute('data-notes-lane') === '1';
      const clearPx = notes ? NOTES_CLEAR_PX : DOCK_CLEAR_PX;
      if (!page || imm) {
        // -1 means "no inline lane": the stylesheet owns --nw-gutter-x (40px on
        // the baseline surface, 0px / 48px inside the immersive rules).
        if (dockLaneRef.current === -1) return false;
        dockLaneRef.current = -1;
        // Hand the lane back to the stylesheet instead of pinning it to 0: the
        // immersive paddings (96px on desktop, 40 + 48px on a small host) are
        // already sized to satisfy the same clearance rule, and an inline 0px
        // would override the small-screen rule and let the dock cover a line.
        s.style.removeProperty('--nw-gutter-x');
        return true;
      }
      const cs = window.getComputedStyle(s);
      const padX = parseFloat(cs.getPropertyValue('--nw-pad-x'));
      const base = Number.isFinite(padX) ? padX : 48;
      // The pane's usable right edge: .nw-scroll's client box excludes the
      // vertical scrollbar, which the dock itself floats over.
      let paneRight = s.getBoundingClientRect().right;
      const own = scrollRef.current;
      if (own && own.clientWidth) {
        const r = own.getBoundingClientRect();
        paneRight = r.left + (own.clientLeft || 0) + own.clientWidth;
      }
      const pageRight = page.getBoundingClientRect().right;
      const blank = Math.max(0, paneRight - pageRight);
      // Lane is the *extra* right padding the text needs beyond --nw-pad-x so
      // that blank + padX + lane >= 88. It is written inline even when it is 0:
      // a wider pane must give the text more room, and letting a wider pane
      // fall back to the stylesheet's default lane would instead narrow it.
      const need = Math.max(0, Math.ceil(clearPx - blank - base));
      if (need === dockLaneRef.current) return false;
      dockLaneRef.current = need;
      s.style.setProperty('--nw-gutter-x', need + 'px');
      return true;
    }

    /**
     * Publishes the room as a CSS variable. Returns true when it changed, in
     * which case the caller must measure *after* this write so the caret math
     * sees the new page padding in the same frame.
     */
    function applyTypewriterRoom(view) {
      const s = surfaceRef.current;
      if (!s) return false;
      const next = typewriterRoom(view) + 'px';
      const prev = s.style.getPropertyValue('--nw-tw-room');
      if (prev === next) return false;
      s.style.setProperty('--nw-tw-room', next);
      return true;
    }

    /**
     * Grows the textarea to its full content height so the outer column rolls.
     *
     * Split into a read phase and a write phase (see refresh) so a frame never
     * interleaves measurements with style writes — each such write forces a
     * synchronous re-layout. Two fast paths keep typing cheap:
     *  - `overflow:hidden` means textarea.scrollHeight reports the *content*
     *    height even when the box is taller, so growing (the common case while
     *    typing: a new wrapped line every few dozen characters) needs one read
     *    and at most one rare style write;
     *  - the "measure with height:auto" dance (two forced reflows) only runs
     *    when the text got shorter or the layout environment changed, i.e. on
     *    deletion, undo, resize, font change or chapter switch.
     *
     * @returns {{h:number}|null} height to write in the write phase (null = none)
     */
    function autosizeRead(view) {
      const ta = taRef.current;
      const v = view || resolveScroller(false);
      const sc = v && v.el;
      if (!ta || !sc) return null;
      // The textarea's minimum height keeps it filling the viewport even when
      // the document is short; it must be based on the *base* page padding, not
      // on the typewriter room (which is blank space the caret can scroll into,
      // not part of the writing column).
      const padY = pageBasePadY();
      const lh = lineHeightPx();
      const viewH = sc.clientHeight || 0;
      // R17 ①: the heading above the first line is real content — the textarea
      // only has to fill what is left of the viewport after it, otherwise a
      // short chapter scrolls even though everything already fits.
      const head = chapterTitleH();
      const minH = Math.max(lh * 3, viewH - padY - head);
      const env = [viewH, lh, padY, head, ta.clientWidth, typewriterRoom(v)].join('|');
      const envChanged = env !== autosizeEnvRef.current;
      autosizeEnvRef.current = env;
      const len = ta.value.length;
      const prevLen = autosizeLenRef.current;
      autosizeLenRef.current = len;
      const curH = parseFloat(ta.style.height) || 0;

      if (!envChanged && curH > 0 && len >= prevLen) {
        // `overflow:hidden` makes the textarea report its real content height:
        // no scrollbar means the content still fits and nothing has to change.
        if (ta.scrollHeight <= ta.clientHeight + 1) return null;
        return { h: Math.max(ta.scrollHeight + 2, minH) };
      }

      // The "height:auto" dance is what makes an exact measurement possible,
      // but it momentarily collapses the writing column to one line. If the
      // column was scrolled, the browser silently clamps scrollTop to 0 (no JS
      // write is involved, so no guard can predict it); every rect measured
      // afterwards would then belong to a viewport that is no longer where the
      // user is looking, and the resulting scroll event reads as "manual" and
      // parks typewriter mode for TYPEWRITER_RESUME_MS. Restore the offset —
      // and claim it, so the scroll event is not mistaken for a user scroll —
      // before the caret measurement of this very frame runs.
      const prevStyle = ta.style.height;
      const savedTop = sc.scrollTop || 0;
      ta.style.height = 'auto';
      const contentH = ta.scrollHeight;
      ta.style.height = prevStyle;
      if (savedTop > 0 && Math.abs((sc.scrollTop || 0) - savedTop) > 2) {
        sc.scrollTop = savedTop;
        expectedScrollTopRef.current = sc.scrollTop || 0;
      }
      return { h: Math.max(contentH + 2, minH) };
    }

    /** Write phase of the height fix (never mixed with reads). */
    function autosizeWrite(h) {
      const ta = taRef.current;
      if (!ta || !h) return;
      const next = h.h + 'px';
      if (ta.style.height !== next) ta.style.height = next;
      if (ta.scrollTop !== 0) ta.scrollTop = 0;
    }

    /** Forces the next autosize to take the exact (two-reflow) path. */
    function invalidateAutosize() {
      autosizeEnvRef.current = '';
      autosizeLenRef.current = -1;
    }

    /** Full pass (read+write) kept for the imperative call sites. */
    function autosize() {
      autosizeWrite(autosizeRead());
    }

    /**
     * Locates the visual line of `offset` (0..value.length).
     *
     * The measuring mirror has exactly the textarea's font/size/line-height,
     * width, padding, white-space:pre-wrap and word-break, so a text prefix
     * wraps at the same points as the real text. Writing prefix + a marker
     * <span> and reading span.getBoundingClientRect() gives the caret line's
     * top — correct for wrapped lines, unlike counting "\n".
     *
     * The mirror is updated *incrementally*: typing appends to the previous
     * prefix, so a single text-node assignment moves the marker instead of
     * rebuilding two nodes per keystroke (the dominant cost when typing fast).
     *
     * @param {number} offset caret offset in the buffer
     * @param {{el:Element, kind:string}} [view] resolved scroller (read phase)
     * @returns {{top:number, height:number, left:number, lineTop:number}|null}
     *   top: caret line box in scroller content coordinates (scroll math)
     *   left/lineTop: caret position inside .nw-stack (thick cursor math)
     */
    function measureCaret(offset, view) {
      const ta = taRef.current;
      const mir = caretRef.current;
      const v = view || resolveScroller(false);
      const sc = v && v.el;
      if (!ta || !mir || !sc) return null;
      const text = ta.value;
      const at = clampNum(Math.round(numOf(offset, ta.selectionStart || 0)), 0, text.length);
      let prefix = text.slice(0, at);
      // Keep the mirror's last line non-empty so its line box always exists:
      // an empty mirror would have no line at all and report a 0-height box.
      if (prefix.charAt(prefix.length - 1) === '\n') prefix += '\u200b';

      const prev = mir.__nwPrefix;
      const mark = mir.__nwMark;
      const reusable =
        mark && typeof prev === 'string' && (prev === prefix || prefix.indexOf(prev) === 0);
      if (reusable) {
        // Same line of text plus a suffix: update the existing text node only.
        const first = mir.firstChild;
        if (first && first.nodeType === 3) first.nodeValue = prefix;
        else if (prefix) mir.insertBefore(document.createTextNode(prefix), mark);
        mir.__nwPrefix = prefix;
      } else {
        clearNode(mir);
        if (prefix) mir.appendChild(document.createTextNode(prefix));
        // The marker is a zero-sized inline-block with vertical-align:top, so
        // its border box sits exactly on the *line box top* (an ordinary inline
        // span would sit on the baseline and be off by half the leading).
        const el = document.createElement('span');
        el.className = 'nw-caret-mark';
        mir.appendChild(el);
        mir.__nwPrefix = prefix;
        mir.__nwMark = el;
      }
      const marker = mir.__nwMark;
      if (!marker) return null;

      // One rect feeds both consumers. The marker is zero-width, so its left
      // edge *is* the caret's x; relative to the mirror's own origin it is
      // already expressed in .nw-stack coordinates (the mirror is pinned to the
      // stack's top-left corner and has the textarea's padding), which is what
      // the absolutely positioned .nw-cursor needs.
      const markRect = marker.getBoundingClientRect();
      const mirRect = mir.getBoundingClientRect();
      const height = lineHeightPx();
      const left = markRect.left - mirRect.left;
      const lineTop = markRect.top - mirRect.top;
      if (v.kind === 'document') {
        return { top: markRect.top + (sc.scrollTop || 0), height, left, lineTop };
      }
      const scRect = sc.getBoundingClientRect();
      return {
        top: markRect.top - scRect.top + (sc.scrollTop || 0),
        height,
        left,
        lineTop,
      };
    }

    // --------------------------------------------------------------- scroll --
    function maxScrollTopOf(el) {
      if (!el) return 0;
      const max = el.scrollHeight - el.clientHeight;
      // For the document element the visible height can be the viewport even
      // when clientHeight reports 0 in quirks-ish embedding contexts.
      if (max > 0) return max;
      return el === (document.scrollingElement || document.documentElement)
        ? Math.max(0, el.scrollHeight - (window.innerHeight || el.clientHeight || 0))
        : 0;
    }

    function maxScrollTop() {
      return maxScrollTopOf((resolveScroller(false) || {}).el);
    }

    /**
     * Computes the scrollTop a caret position needs (read phase, no writes).
     *
     * `getM` is an optional lazy accessor for a caret measurement shared with
     * the thick-cursor paint: one refresh pass must measure the mirror only
     * once, and only when either consumer actually needs it.
     */
    function caretScrollTop(mode, view, getM) {
      const v = view || resolveScroller(false);
      const sc = v && v.el;
      const ta = taRef.current;
      if (!sc || !ta) return null;
      const m = getM ? getM() : measureCaret(ta.selectionStart || 0, v);
      if (!m) return null;
      const viewH = sc.clientHeight || window.innerHeight || 0;
      if (mode === 'center') {
        const centered = m.top + m.height / 2 - viewH / 2;
        // Typewriter mode pads the page by half a viewport so *any* line —
        // including the first one — can be scrolled to the middle. Centring a
        // caret that sits on the first line therefore resolves to scrollTop 0,
        // which drops that line halfway down an otherwise blank pane: that is
        // the "打开小说，首行从中间开始" report. It kept coming back because
        // the chapter-switch effect scrolls to `room` and any later re-centre
        // (onSelect fires when the effect re-sets the selection, onFocus, the
        // 1.5 s scroller recheck) undid it.
        //
        // `room` is by definition the offset that puts line one back on its
        // normal page margin, so it is also the floor for centring: the head of
        // a chapter can never scroll above the head of the pane. Deeper carets
        // are unaffected (their centred offset is already larger than room),
        // and with typewriter off room is 0, so nothing changes there either.
        const floor = typewriterRoom(v);
        return centered < floor ? floor : centered;
      }
      const pad = Math.max(28, m.height);
      const viewTop = sc.scrollTop || 0;
      const viewBottom = viewTop + viewH;
      if (m.top - pad < viewTop) return m.top - pad;
      if (m.top + m.height + pad > viewBottom) return m.top + m.height + pad - viewH;
      return null; // already visible: do not touch the viewport at all
    }

    /** Sets scrollTop and marks it as script-driven (so it is not "manual"). */
    function setScrollTop(value, view) {
      const v = view || resolveScroller(false);
      const sc = v && v.el;
      if (!sc) return;
      const target = clampNum(numOf(value, 0), 0, maxScrollTopOf(sc));
      // Remember the exact offset we asked for; the scroll listener compares
      // against it instead of using a timing window, which is far more robust
      // than guessing how many milliseconds the async scroll event takes.
      expectedScrollTopRef.current = target;
      const prev = sc.scrollTop;
      sc.scrollTop = target;
      // Browsers clamp fractional scroll offsets; remember the real value so a
      // scroll event landing on it is never mistaken for manual scrolling.
      if (sc.scrollTop !== prev) expectedScrollTopRef.current = sc.scrollTop;
    }

    function centerCaret() {
      const target = caretScrollTop('center');
      if (target == null) return;
      setScrollTop(target);
    }

    function ensureCaretVisible() {
      const target = caretScrollTop('nearest');
      if (target == null) return;
      setScrollTop(target);
    }

    function scrollOffsetToCenter(offset) {
      const v = resolveScroller(false);
      const sc = v && v.el;
      if (!sc) return;
      const m = measureCaret(offset, v);
      if (!m) return;
      setScrollTop(m.top + m.height / 2 - (sc.clientHeight || 0) / 2, v);
    }

    // ------------------------------------------------------------ selection --
    function emitSelection() {
    const cb = propsRef.current.onSelectionChange;
    const ta = taRef.current;
    let value = '';
    let start = 0;
    let end = 0;
    if (ta) {
      value = ta.value;
      start = ta.selectionStart || 0;
      end = ta.selectionEnd || 0;
    }
    // Cheap dedupe: this fires on every throttled measurement during typing.
    // Re-emitting an identical payload would re-render the whole App tree
    // (shelf included) dozens of times per second for no visual change.
    if (
      start === lastSelRef.current.start &&
      end === lastSelRef.current.end &&
      value === lastSelRef.current.value
    ) {
      return;
    }
    lastSelRef.current = { start, end, value };
    if (typeof cb !== 'function') return;
    const words = countWordsOf(value);
    const lc = lineColOf(value, start);
    const info = {
      // CONTRACT §5 / lead addendum: { start, end, line, col, wordCount, selected }
      start,
      end,
      line: lc.line,
      col: lc.col,
      wordCount: words,
      selected: end - start,
      // Extra aliases kept for older call sites.
      words,
      chars: value.length,
      selStart: start,
      selEnd: end,
    };
    try {
      cb(info);
    } catch (err) {
      /* a parent-side bug must never break typing */
    }
  }

    // ------------------------------------------------------------ highlight --
    function rebuildHighlights() {
      const hl = hlRef.current;
      const ta = taRef.current;
      if (!hl || !ta) return;
      const text = ta.value;
      const ranges = [];
      const ext = highlightsRef.current || [];
      for (let i = 0; i < ext.length; i += 1) {
        const r = ext[i];
        if (!r) continue;
        const s = clampNum(numOf(r.start, 0), 0, text.length);
        const e = clampNum(numOf(r.end, s), s, text.length);
        if (e > s) ranges.push({ start: s, end: e, id: r.id, active: !!r.active, kind: 'hl' });
      }
      const f = findRef.current;
      if (f.open && f.matches && f.matches.length) {
        for (let i = 0; i < f.matches.length; i += 1) {
          const m = f.matches[i];
          if (m.end > m.start) {
            ranges.push({ start: m.start, end: m.end, active: i === f.index, kind: 'find' });
          }
        }
      }
      if (!ranges.length) {
        if (hl.firstChild) clearNode(hl);
        return;
      }
      ranges.sort((a, b) => a.start - b.start || a.end - b.end);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i];
        const s = Math.max(pos, r.start);
        if (r.end <= s) continue;
        if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
        const el = document.createElement('mark');
        el.className = r.kind === 'find' ? 'nw-find-hit' : 'nw-hl-mark';
        if (r.active) el.setAttribute('data-active', '1');
        if (r.id !== undefined && r.id !== null) el.setAttribute('data-id', String(r.id));
        el.textContent = text.slice(s, r.end);
        frag.appendChild(el);
        pos = r.end;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      clearNode(hl);
      hl.appendChild(frag);
    }

    // ------------------------------------------------------------- refresh --
    function isManuallyScrolling() {
      return nowMs() - manualAtRef.current < TYPEWRITER_RESUME_MS;
    }

    /**
     * Scroll policy.
     *
     * `wantCenter` means the caret actually moved or the text changed, so the
     * caret is what the writer is looking at right now. Layout-only refreshes
     * (resize, theme change, chapter load) pass false and never move the
     * viewport.
     *
     * While the user is moving the viewport by hand the typewriter is parked:
     * a layout refresh then does nothing at all (so it can never drag the view
     * back), and only a real caret/text change is allowed to pull the caret
     * into view — otherwise typing would insert text off-screen. After 800 ms
     * without further manual scrolling the next input centres the caret again.
     *
     * Read phase: returns the scrollTop the caret needs, or null to leave the
     * viewport completely alone. All writes happen later in the frame.
     */
    function planCaretScroll(wantCenter, view, getM) {
      if (!taRef.current) return null;
      // Only a caret/text change may move the viewport; layout refreshes never do.
      if (!wantCenter) return null;
      // Never move the page mid drag-selection.
      if (draggingRef.current) return null;
      // Hard rule: while the manual-scroll window is open the script does not
      // touch scrollTop at all — the view can never be yanked back. It reopens
      // 800 ms after the last manual scroll, and the next input then re-centres.
      if (isManuallyScrolling()) return null;
      const cfg = cfgRef.current || {};
      return caretScrollTop(cfg.typewriterOn !== false ? 'center' : 'nearest', view, getM);
    }

    /** One-shot policy application (imperative paths outside the frame loop). */
    function applyCaretScroll(wantCenter) {
      const view = resolveScroller(false);
      const target = planCaretScroll(wantCenter, view);
      if (target != null) setScrollTop(target, view);
    }

    /**
     * Read phase for the thick caret: where should .nw-cursor sit, and should
     * it be painted at all?
     *
     * Shares measureCaret() with the typewriter, so the cursor can never drift
     * from the line the viewport is centring. Hidden while there is a
     * selection (the native selection already marks the spot), during IME
     * composition (the platform draws its own candidate underline), and when
     * the textarea is not focused (a caret in an unfocused editor is noise).
     *
     * @returns {{left:number, top:number, visible:boolean}|null} write-phase plan
     */
    function planCaretPaint(view, getM) {
      const ta = taRef.current;
      if (!ta) return null;
      // A caret is only meaningful when the editor owns the focus. Tracking the
      // window's own focus in a ref is more reliable than document.hasFocus(),
      // which some embedding shells report optimistically.
      const visible =
        !composingRef.current &&
        winFocusedRef.current &&
        (ta.selectionStart || 0) === (ta.selectionEnd || 0) &&
        ta === (ta.ownerDocument || document).activeElement;
      if (!visible) return { left: 0, top: 0, height: 0, visible: false };
      const m = getM ? getM() : measureCaret(ta.selectionStart || 0, view);
      if (!m) return { left: 0, top: 0, height: 0, visible: false };
      return { left: m.left, top: m.lineTop, height: m.height, visible: true };
    }

    /**
     * Write phase for .nw-cursor. Never reads layout, never forces a reflow.
     *
     * The blink is restarted on every move by toggling between two identical
     * keyframes: assigning animation-name is a style-only change, whereas
     * reading/forcing an animation restart through getAnimations() would cost
     * a layout flush on every keystroke.
     */
    function paintCaret(plan) {
      const el = cursorRef.current;
      if (!el) return;
      if (!plan || !plan.visible) {
        if (el.getAttribute('data-visible') !== '0') {
          el.setAttribute('data-visible', '0');
        }
        return;
      }
      const tx = 'translate3d(' + Math.round(plan.left) + 'px,' + Math.round(plan.top) + 'px,0)';
      const hh = Math.max(8, Math.round(plan.height)) + 'px';
      if (el.__nwH !== hh) {
        el.style.height = hh;
        el.__nwH = hh;
      }
      if (el.__nwTx !== tx) {
        el.style.transform = tx;
        el.__nwTx = tx;
        // Only a real move restarts the blink, so holding a key still blinks
        // but a plain re-render does not.
        const alt = el.style.animationName === 'nw-caret-blink-b';
        el.style.animationName = alt ? 'nw-caret-blink' : 'nw-caret-blink-b';
      }
      if (el.getAttribute('data-visible') !== '1') el.setAttribute('data-visible', '1');
    }

    /**
     * The single measure pass, split into a read phase and a write phase.
     *
     * Everything that needs layout geometry is read first (scroller, textarea
     * content height, caret rect). Only then are styles and scrollTop written.
     * Interleaving the two would force a synchronous re-layout per write, which
     * is what made fast typing feel sticky.
     */
    function refresh(wantCenter) {
      const ta = taRef.current;
      if (!ta) {
        emitSelection();
        return;
      }
      // ---------- read phase ----------
      let view = resolveScroller(false);
      // Turning typewriter on/off changes the page padding, and every caret
      // coordinate below is measured against that padding, so the room has to
      // be published before the caret is measured (one style write, only when
      // the value actually changed). The measurement that follows then flushes
      // layout once and reads the new geometry instead of the previous frame's.
      applyTypewriterRoom(view);
      // The area the caret can scroll into just changed (room added/removed, or
      // the text grew past the panel): a fallback scroller may now be wrong.
      upgradeScrollerIfNeeded();
      view = resolveScroller(false);
      const height = autosizeRead(view);
      // One mirror measurement per pass, shared by the typewriter scroll math
      // and the thick-caret paint. Both need the same rect of the same caret;
      // measuring twice would double the forced reflow cost on every keystroke.
      let caretMemo;
      let caretMemoSet = false;
      const getM = () => {
        if (!caretMemoSet) {
          caretMemoSet = true;
          caretMemo = measureCaret(ta.selectionStart || 0, view);
        }
        return caretMemo;
      };
      const scrollTarget = planCaretScroll(!!wantCenter, view, getM);
      const caretPlan = planCaretPaint(view, getM);
      // ---------- write phase ----------
      autosizeWrite(height);
      if (scrollTarget != null) setScrollTop(scrollTarget, view);
      paintCaret(caretPlan);
      rebuildHighlights();
      emitSelection();
    }

    /**
     * Coalesced measurement pass: one frame, one measurement.
     *
     * A burst of keystrokes previously scheduled one 60 ms timeout each and
     * every pass measured the caret (two forced reflows). Now all input inside
     * the same animation frame collapses into a single pass, and the frame
     * callback owns both phases. The paired timeout keeps the old MEASURE_MS
     * bound so a throttled/hidden tab (where rAF may not run) still measures.
     * Centre requests are sticky: they survive until a pass consumes them.
     */
    function scheduleMeasure(wantCenter) {
      if (wantCenter) pendingCenterRef.current = true;
      if (measureQueuedRef.current) return;
      measureQueuedRef.current = true;

      const run = () => {
        if (!measureQueuedRef.current) return;
        measureQueuedRef.current = false;
        const raf = measureRafRef.current;
        if (raf) {
          measureRafRef.current = 0;
          if (typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(raf);
          }
        }
        if (measureTimerRef.current) {
          window.clearTimeout(measureTimerRef.current);
          measureTimerRef.current = 0;
        }
        const center = pendingCenterRef.current;
        pendingCenterRef.current = false;
        refresh(center);
      };

      if (typeof window.requestAnimationFrame === 'function') {
        measureRafRef.current = window.requestAnimationFrame(run);
        measureTimerRef.current = window.setTimeout(run, MEASURE_MS);
      } else {
        measureTimerRef.current = window.setTimeout(run, MEASURE_MS);
      }
    }

    // ----------------------------------------------------------- auto save --
    function cancelSave() {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = 0;
      }
    }

    function currentValue() {
      const ta = taRef.current;
      return ta ? ta.value : valueRef.current;
    }

    function commitSave(immediate) {
      cancelSave();
      if (chapterIdRef.current == null) return;
      const text = currentValue();
      // Debounced writes are skipped when nothing changed since the last one.
      // Immediate writes (blur / Ctrl+S / api.flush / unmount / beforeunload)
      // are always emitted: the app keys its "已保存" state and its version
      // snapshots off them, and a same-text write is harmless. Cross-writing a
      // *different* chapter cannot happen: a new chapter means a new instance
      // (App keys the editor by chapter.id), and the app flushes before it
      // swaps chapterRef, so this closure can only ever see its own buffer.
      if (!immediate && lastSavedRef.current !== null && text === lastSavedRef.current) return;
      lastSavedRef.current = text;
      dirtyRef.current = false;
      valueRef.current = text;
      const fn = propsRef.current.onSave;
      if (typeof fn !== 'function') return;
      try {
        const result = fn(text, !!immediate);
        if (result && typeof result.then === 'function') {
          result.then(null, () => {
            // Persist failed: keep the buffer dirty so the next pass retries.
            lastSavedRef.current = null;
            dirtyRef.current = true;
          });
        }
      } catch (err) {
        lastSavedRef.current = null;
        dirtyRef.current = true;
      }
    }

    function flushNow() {
      cancelSave();
      commitSave(true);
    }

    function scheduleSave() {
      cancelSave();
      const cfg = cfgRef.current || {};
      const ms = clampNum(numOf(cfg.autoSaveMs, 1200), 200, 60000);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = 0;
        commitSave(false);
      }, ms);
    }

    // ---------------------------------------------------------- text edits --
    /** Marks the buffer dirty and schedules the debounced save + re-measure. */
    function afterEdit() {
      const ta = taRef.current;
      if (!ta) return;
      valueRef.current = ta.value;
      dirtyRef.current = true;
      scheduleSave();
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
    }

    /**
     * Inserts `text` replacing the selection. Prefers execCommand so the
     * browser's native undo stack keeps working; falls back to a manual splice.
     */
    function insertText(text, selStartOffset, selEndOffset) {
      const ta = taRef.current;
      if (!ta) return;
      const value = typeof text === 'string' ? text : String(text == null ? '' : text);
      const s = ta.selectionStart || 0;
      const e = ta.selectionEnd || 0;
      const wantA = typeof selStartOffset === 'number' ? selStartOffset : value.length;
      const wantB = typeof selEndOffset === 'number' ? selEndOffset : value.length;
      let done = false;
      try {
        ta.focus();
        done = document.execCommand('insertText', false, value);
      } catch (err) {
        done = false;
      }
      if (!done) ta.value = ta.value.slice(0, s) + value + ta.value.slice(e);
      const a = clampNum(s + wantA, 0, ta.value.length);
      const b = clampNum(s + wantB, 0, ta.value.length);
      try {
        ta.setSelectionRange(a, Math.max(a, b));
      } catch (err) {
        /* ignore */
      }
      afterEdit();
    }

    function wrapSelection(token) {
      const ta = taRef.current;
      if (!ta) return;
      const s = ta.selectionStart || 0;
      const e = ta.selectionEnd || 0;
      const selected = ta.value.slice(s, e);
      const wrapped = token + selected + token;
      insertText(wrapped, token.length, token.length + selected.length);
    }

    /** Full content replacement (external API / replace-all / version restore). */
    function setEditorText(next, selStart, selEnd) {
      const ta = taRef.current;
      if (!ta) return;
      const text = typeof next === 'string' ? next : '';
      if (ta.value !== text) ta.value = text;
      valueRef.current = text;
      const a = clampNum(numOf(selStart, text.length), 0, text.length);
      const b = clampNum(numOf(selEnd, a), a, text.length);
      try {
        ta.setSelectionRange(a, b);
      } catch (err) {
        /* ignore */
      }
      dirtyRef.current = true;
      scheduleSave();
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
      rebuildHighlights();
    }

    function replaceRange(start, end, text) {
      const ta = taRef.current;
      if (!ta) return;
      const s = clampNum(numOf(start, 0), 0, ta.value.length);
      const e = clampNum(numOf(end, s), s, ta.value.length);
      const insert = typeof text === 'string' ? text : String(text == null ? '' : text);
      const next = ta.value.slice(0, s) + insert + ta.value.slice(e);
      const caret = s + insert.length;
      setEditorText(next, caret, caret);
      flushNow(); // external edits are discrete: persist right away
    }

    function setHighlights(list) {
      highlightsRef.current = Array.isArray(list) ? list.slice() : [];
      rebuildHighlights();
    }

    // -------------------------------------------------------- find & replace --
    function openFind(open) {
      const f = findRef.current;
      const next = !!open;
      if (f.open === next) {
        if (next) {
          window.setTimeout(() => {
            const el = findInputRef.current;
            if (el) {
              el.focus();
              el.select();
            }
          }, 0);
        }
        return;
      }
      f.open = next;
      f.notice = '';
      f.index = 0;
      f.matches = [];
      if (next) refreshMatches();
      bumpFind();
      scheduleMeasure(false);
      if (next) {
        window.setTimeout(() => {
          const el = findInputRef.current;
          if (el) {
            el.focus();
            el.select();
          }
        }, 0);
      }
    }

    function closeFind(refocus) {
      const wasOpen = findRef.current.open;
      openFind(false);
      if (wasOpen && refocus !== false) {
        const ta = taRef.current;
        if (ta) ta.focus();
      }
    }

    function refreshMatches() {
      const ta = taRef.current;
      const f = findRef.current;
      if (!ta || !f.open) {
        f.matches = [];
        f.index = 0;
        bumpFind();
        return;
      }
      const matches = collectMatches(ta.value, f.query);
      f.matches = matches;
      if (!matches.length) {
        f.index = 0;
      } else {
        const selStart = ta.selectionStart || 0;
        const selEnd = ta.selectionEnd || 0;
        let exact = -1;
        for (let i = 0; i < matches.length; i += 1) {
          if (matches[i].start === selStart && matches[i].end === selEnd) {
            exact = i;
            break;
          }
        }
        if (exact >= 0) f.index = exact;
        else {
          let idx = 0;
          for (let i = 0; i < matches.length; i += 1) {
            if (matches[i].start <= selStart) idx = i;
            else break;
          }
          f.index = idx;
        }
      }
      bumpFind();
    }

    function selectMatch(index) {
      const ta = taRef.current;
      const f = findRef.current;
      if (!ta || !f.matches.length) return;
      const i = clampNum(Math.round(numOf(index, 0)), 0, f.matches.length - 1);
      f.index = i;
      const m = f.matches[i];
      try {
        ta.setSelectionRange(m.start, m.end);
      } catch (err) {
        /* ignore */
      }
      scrollOffsetToCenter(m.start);
      bumpFind();
    }

    function stepMatch(dir) {
      const ta = taRef.current;
      const f = findRef.current;
      if (!ta) return;
      if (!f.matches.length) refreshMatches();
      const list = findRef.current.matches;
      if (!list.length) {
        bumpFind();
        return;
      }
      const selStart = ta.selectionStart || 0;
      const selEnd = ta.selectionEnd || 0;
      let idx = -1;
      if (dir >= 0) {
        for (let i = 0; i < list.length; i += 1) {
          if (list[i].start > selStart || (list[i].start === selStart && list[i].end > selEnd)) {
            idx = i;
            break;
          }
        }
        if (idx < 0) idx = 0;
      } else {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].end < selEnd || (list[i].end === selEnd && list[i].start < selStart)) {
            idx = i;
            break;
          }
        }
        if (idx < 0) idx = list.length - 1;
      }
      selectMatch(idx);
    }

    function scheduleNoticeClear() {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => {
        noticeTimerRef.current = 0;
        findRef.current.notice = '';
        bumpFind();
      }, 1800);
    }

    function doReplace() {
      const ta = taRef.current;
      const f = findRef.current;
      if (!ta || !f.query) return;
      if (!f.matches.length) refreshMatches();
      const list = findRef.current.matches;
      if (!list.length) return;
      let target = list[f.index] || null;
      if (!target || ta.selectionStart !== target.start || ta.selectionEnd !== target.end) {
        for (let i = 0; i < list.length; i += 1) {
          if (list[i].start === (ta.selectionStart || 0)) {
            target = list[i];
            break;
          }
        }
      }
      if (!target) target = list[f.index] || list[0];
      const restore = document.activeElement;
      try {
        ta.focus();
        ta.setSelectionRange(target.start, target.end);
      } catch (err) {
        return;
      }
      insertText(f.replace);
      if (restore && restore !== ta && typeof restore.focus === 'function') {
        try {
          restore.focus();
        } catch (err) {
          /* ignore */
        }
      }
      const nextList = findRef.current.matches;
      if (!nextList.length) return;
      const from = target.start + f.replace.length;
      let next = -1;
      for (let i = 0; i < nextList.length; i += 1) {
        if (nextList[i].start >= from) {
          next = i;
          break;
        }
      }
      selectMatch(next < 0 ? 0 : next);
    }

    function replaceAll() {
      const ta = taRef.current;
      const f = findRef.current;
      if (!ta || !f.query) return;
      const list = collectMatches(ta.value, f.query);
      if (!list.length) {
        f.notice = NW.t('无匹配');
        bumpFind();
        scheduleNoticeClear();
        return;
      }
      // One-shot rebuild: offsets stay consistent and nothing is applied twice.
      let out = '';
      let pos = 0;
      for (let i = 0; i < list.length; i += 1) {
        out += ta.value.slice(pos, list[i].start) + f.replace;
        pos = list[i].end;
      }
      out += ta.value.slice(pos);
      const caret = clampNum(list[0].start, 0, out.length);
      setEditorText(out, caret, caret);
      flushNow();
      f.notice = NW.t('已替换 {0} 处', list.length);
      refreshMatches();
      bumpFind();
      scheduleNoticeClear();
    }

    // -------------------------------------------------------------- handlers --
    function handleInput() {
      const ta = taRef.current;
      if (!ta) return;
      valueRef.current = ta.value;
      dirtyRef.current = true;
      scheduleSave();
      if (composingRef.current) {
        // IME composition: never re-centre mid-composition.
        emitSelection();
        return;
      }
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
    }

    function handleKeyDown(ev) {
      const ta = taRef.current;
      if (!ta) return;
      if (ev.isComposing || composingRef.current) return;
      const meta = ev.ctrlKey || ev.metaKey;

      if (ev.key === 'Tab' && !meta && !ev.altKey && !ev.shiftKey) {
        ev.preventDefault();
        insertText(TAB_TEXT);
        return;
      }
      if (meta && (ev.key === 'b' || ev.key === 'B')) {
        ev.preventDefault();
        wrapSelection('**');
        return;
      }
      if (meta && (ev.key === 'i' || ev.key === 'I')) {
        ev.preventDefault();
        wrapSelection('*');
        return;
      }
      if (meta && (ev.key === 's' || ev.key === 'S')) {
        ev.preventDefault();
        flushNow();
        return;
      }
      if (meta && (ev.key === 'f' || ev.key === 'F')) {
        ev.preventDefault();
        openFind(true);
        return;
      }
      // R22: Alt+N starts the next chapter without leaving the keyboard, and
      // Alt+A toggles the revision panel. Ctrl+N / Ctrl+Shift+A would collide
      // with the browser (new window) and with nothing at all respectively, so
      // Alt is the safe modifier here.
      if (ev.altKey && !meta && !ev.ctrlKey && (ev.key === 'n' || ev.key === 'N') && onNewChapter) {
        ev.preventDefault();
        flushNow();
        onNewChapter();
        return;
      }
      if (ev.altKey && !meta && !ev.ctrlKey && (ev.key === 'a' || ev.key === 'A') && onToggleAdvice) {
        ev.preventDefault();
        onToggleAdvice();
        return;
      }
      if (ev.key === 'Escape') {
        if (findRef.current.open) {
          ev.preventDefault();
          closeFind();
        }
        return;
      }

      const nav =
        ev.key === 'PageUp' ||
        ev.key === 'PageDown' ||
        ev.key === 'Home' ||
        ev.key === 'End' ||
        ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown';
      if (nav) {
        // Keyboard navigation counts as manual viewport movement: park the
        // typewriter for a moment so it cannot yank the view back.
        manualAtRef.current = nowMs();
        if ((ev.key === 'PageUp' || ev.key === 'PageDown') && !meta && !ev.altKey) {
          // The textarea is grown to full height, so its native paging would
          // jump to the document edge; page the outer column instead.
          ev.preventDefault();
          const view = resolveScroller(false);
          const sc = view && view.el;
          if (sc) {
            const viewH = sc.clientHeight || window.innerHeight || 0;
            const step = Math.max(60, viewH - lineHeightPx());
            const dir = ev.key === 'PageDown' ? 1 : -1;
            setScrollTop((sc.scrollTop || 0) + dir * step * (ev.shiftKey ? 0.5 : 1), view);
          }
        }
      }
    }

    function handleBlur() {
      flushNow();
      // Unfocused editor: the painted caret hides (the browser has no caret of
      // its own to show either). A measurement pass is all that is needed.
      scheduleMeasure(false);
    }

    function handleCompositionStart() {
      composingRef.current = true;
      // Hide the painted caret; the IME draws its own composition UI.
      scheduleMeasure(false);
    }

    function handleCompositionEnd() {
      composingRef.current = false;
      const ta = taRef.current;
      if (!ta) return;
      valueRef.current = ta.value;
      dirtyRef.current = true;
      scheduleSave();
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
    }

    function onFindKeyDown(ev, role) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeFind();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        if (role === 'replace') doReplace();
        else stepMatch(ev.shiftKey ? -1 : 1);
        return;
      }
      if (ev.key === 'F3') {
        ev.preventDefault();
        stepMatch(ev.shiftKey ? -1 : 1);
      }
    }

    // ------------------------------------------------------- external API ----
    if (!apiRef.current) {
      apiRef.current = {
        /** Replace the whole buffer and persist it immediately. */
        setContent(next) {
          const ta = taRef.current;
          if (!ta) return;
          const text = typeof next === 'string' ? next : '';
          setEditorText(text, text.length, text.length);
          flushNow();
        },
        getContent() {
          return currentValue();
        },
        flush() {
          flushNow();
        },
        replaceRange(start, end, text) {
          replaceRange(start, end, text);
        },
        insertAtCursor(text) {
          insertText(typeof text === 'string' ? text : String(text == null ? '' : text));
        },
        focus() {
          const ta = taRef.current;
          if (ta) ta.focus();
        },
        getSelection() {
          const ta = taRef.current;
          if (!ta) return { start: 0, end: 0, text: '' };
          const start = ta.selectionStart || 0;
          const end = ta.selectionEnd || 0;
          return { start, end, text: ta.value.slice(start, end) };
        },
        /**
         * Scroller used by the host: `.nw-scroll` normally, an ancestor shell
         * pane or the document when the panel is not height-constrained.
         * Exposed so a host/test can verify which element typewriter drives.
         */
        getScroller() {
          const v = resolveScroller(true);
          return { kind: v.kind, el: v.el || null };
        },
        getScrollRatio() {
          const sc = (resolveScroller(false) || {}).el;
          if (!sc) return 0;
          const max = maxScrollTopOf(sc);
          if (max <= 0) return 0;
          return clampNum((sc.scrollTop || 0) / max, 0, 1);
        },
        scrollTo(value) {
          // A programmatic scroll is an explicit intent: drop any queued
          // caret-centring, otherwise the pending measure pass would
          // immediately yank the viewport back to the caret.
          pendingCenterRef.current = false;
          const raw = numOf(value, 0);
          if (Math.abs(raw) <= 1) setScrollTop(raw * maxScrollTop());
          else setScrollTop(raw);
        },
        setHighlights(list) {
          setHighlights(list);
        },
        /**
         * Scrolls an arbitrary character range to the vertical middle of the
         * viewport (R23). The advice panel used to approximate this with
         * getScrollRatio + scrollTo(start / textLength), which lands wherever
         * the ratio happens to point — often a screen away from the quoted
         * sentence. Measuring the offset is exact and costs one mirror pass.
         */
        centerRange(start, end) {
          // An explicit scroll is an intent: drop any queued caret centring so
          // the pending measure pass cannot yank the viewport back.
          pendingCenterRef.current = false;
          const v = resolveScroller(false);
          const sc = v && v.el;
          const ta = taRef.current;
          if (!sc || !ta) return false;
          const from = clampNum(numOf(start, 0), 0, ta.value.length);
          const m = measureCaret(from, v);
          if (!m) return false;
          const viewH = sc.clientHeight || window.innerHeight || 0;
          setScrollTop(m.top + m.height / 2 - viewH / 2, v);
          return true;
        },
        openFind() {
          openFind(true);
        },
      };
    }

    // -------------------------------------------------------------- effects --
    // Chapter switch: flush the outgoing buffer, then load the incoming one.
    // The app flushes through api.flush() before it switches (CONTRACT §6), so
    // this flush is a safety net for the buffer it still owns.
    React.useEffect(() => {
      const prevId = chapterIdRef.current;
      const nextId = chapterId;
      if (prevId === nextId) return;

      if (prevId != null && dirtyRef.current) flushNow();
      chapterIdRef.current = nextId;
      cancelSave();

      const ta = taRef.current;
      const text = chapter && typeof chapter.content === 'string' ? chapter.content : '';
      valueRef.current = text;
      lastSavedRef.current = nextId == null ? null : text;
      dirtyRef.current = false;
      highlightsRef.current = [];
      manualAtRef.current = -1e9;
      composingRef.current = false;

      const f = findRef.current;
      f.open = false;
      f.query = '';
      f.replace = '';
      f.matches = [];
      f.index = 0;
      f.notice = '';
      bumpFind();

      if (ta) {
        ta.value = text;
        try {
          ta.setSelectionRange(0, 0);
        } catch (err) {
          /* ignore */
        }
        // New chapter => new content height: force the exact autosize path.
        invalidateAutosize();
        const view = syncScroller();
        // The lane is chapter-independent but the pane may have just been laid
        // out for the first time; it is cheap and idempotent.
        applyDockLane();
        if (view) {
          // Publish the typewriter room before measuring so the padding is final.
          applyTypewriterRoom(view);
        }
        autosize();
        if (view) {
          // R16 ⑦: typewriter mode pads the page by half a viewport above the
          // first line, so scrolling to 0 lands the text halfway down the pane —
          // which is what "导入后第一行从中间开始" was. Scrolling past exactly
          // that padding leaves the normal page margin and starts at line one.
          const start = typewriterRoom(view);
          expectedScrollTopRef.current = start;
          view.scrollTop = start;
        }
        rebuildHighlights();
        scheduleMeasure(false);
      }
      emitSelection();
    }, [chapterId]);

    // Renaming a chapter changes the heading's height (one line -> two), which
    // changes both the typewriter room and the textarea's minimum height. The
    // chapter effect above only runs on id changes, so re-measure here.
    React.useEffect(() => {
      if (!surfaceRef.current || !taRef.current) return;
      const view = resolveScroller(false);
      if (view) applyTypewriterRoom(view);
      autosize();
      rebuildHighlights();
      scheduleMeasure(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chapterTitle]);

    // The 灵感便签 column can be opened/closed at any time; re-reserve the lane
    // and re-measure so the text column never runs under the floating panel.
    React.useEffect(() => {
      if (!surfaceRef.current) return;
      if (applyDockLane()) {
        autosize();
        rebuildHighlights();
        scheduleMeasure(false);
      }
    }, [notesLane]);

    // Adopt content the app pushed for the SAME chapter (version restore, AI
    // rewrite). Skipped when it merely echoes what we just saved, which is what
    // keeps the textarea effectively uncontrolled — no caret jumping on save.
    const incomingContent =
      chapter && typeof chapter.content === 'string' ? chapter.content : null;
    React.useEffect(() => {
      if (incomingContent === null || chapterIdRef.current == null) return;
      const ta = taRef.current;
      if (!ta) return;
      if (incomingContent === ta.value) return;
      if (incomingContent === lastSavedRef.current) return;
      setEditorText(incomingContent, incomingContent.length, incomingContent.length);
    }, [incomingContent]);

    // Listeners are attached once; every callback reads refs for freshness.
    React.useEffect(() => {
      // Manual-viewport detection. Wheel/touch and keyboard paging are
      // unambiguous. A bare scroll event is only manual when it did not land on
      // the offset the script itself just requested, so the typewriter's own
      // centred scrollTop never counts as "the user took over".
      //
      // The handlers are stored in a ref so bindScrollHooks() can rebind them
      // when resolveScroller() picks a different element (e.g. the host's panel
      // turns out to be the real scroller instead of `.nw-scroll`).
      const markManual = () => {
        manualAtRef.current = nowMs();
      };
      const onWheel = markManual;
      const onTouchMove = markManual;
      const onScroll = () => {
        const sc = scrollerRef.current;
        const at = sc ? sc.scrollTop || 0 : 0;
        if (Math.abs(at - expectedScrollTopRef.current) <= 2) return;
        markManual();
      };
      scrollHooksRef.current = { wheel: onWheel, touchmove: onTouchMove, scroll: onScroll };

      // Fallback for the case where the *real* scroller is not one we resolved
      // (or stops being it between two rechecks): a scroll that bubbles up to
      // the window still marks the viewport as user-controlled. Div scroll
      // events do not bubble, only the document's own scroll reaches window, so
      // when we already listen on document.scrollingElement this fires twice —
      // onScroll is idempotent (it either returns or re-stamps the same time).
      const onWindowScroll = () => onScroll();

      const onSelectionChange = () => {
        const ta = taRef.current;
        if (!ta || document.activeElement !== ta) return;
        scheduleMeasure(true);
      };
      // Window blur/focus also matter: the painted caret must disappear when
      // the whole app loses focus (Alt+Tab) even though the textarea keeps
      // document.activeElement, and reappear when the user comes back.
      const onWindowBlur = () => {
        winFocusedRef.current = false;
        scheduleMeasure(false);
      };
      const onWindowFocus = () => {
        winFocusedRef.current = true;
        scheduleMeasure(false);
      };
      const onMouseUp = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        // A drag-selection ended: re-centre once, now that it is safe to move.
        scheduleMeasure(true);
      };
      const onBeforeUnload = () => {
        flushNow();
      };
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') flushNow();
      };
      // Resize can change which element scrolls: re-resolve before measuring.
      const onResize = () => {
        syncScrollerAndMeasure();
      };

      // Resolve against the live DOM (the refs are set by the time effects run)
      // and bind the scroll listeners to whatever actually scrolls.
      syncScroller();
      bindScrollHooks();
      document.addEventListener('selectionchange', onSelectionChange);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onWindowScroll, { passive: true });
      // Capture phase on window: `blur` does not bubble, so only a capture
      // listener on window sees the textarea's own blur.
      window.addEventListener('blur', onWindowBlur, true);
      window.addEventListener('focus', onWindowFocus, true);
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('mouseup', onMouseUp);

      let observer = null;
      const tryObserve = () => {
        if (typeof ResizeObserver !== 'function') return;
        const sc = scrollerRef.current;
        if (!sc) return;
        if (!observer) {
          observer = new ResizeObserver(() => {
            // The panel may just have been given a height (or lost one): the
            // scroller identity can change here, so re-resolve, rebind, measure.
            syncScrollerAndMeasure();
          });
          scrollObserverRef.current = observer;
        }
        try {
          observer.disconnect();
          observer.observe(sc);
        } catch (err) {
          /* observing a detached node throws in some engines */
        }
      };
      tryObserve();

      // The identity of the scroller is re-checked periodically and on every
      // layout-affecting event: host panels mount lazily, so a one-shot resolve
      // at mount time can see a still-collapsed panel.
      const recheckTimer = window.setInterval(() => {
        const prev = scrollerRef.current;
        syncScroller();
        if (scrollerRef.current !== prev) {
          tryObserve();
          // Identity changed without a resize event (lazy host mount): the
          // caret has to be re-centred for the new port.
          scheduleMeasure(true);
        }
      }, 1500);

      return () => {
        const hooks = scrollHooksRef.current;
        const bound = boundScrollRef.current;
        if (hooks && bound) {
          bound.removeEventListener('wheel', hooks.wheel);
          bound.removeEventListener('touchmove', hooks.touchmove);
          bound.removeEventListener('scroll', hooks.scroll);
        }
        boundScrollRef.current = null;
        scrollHooksRef.current = null;
        window.clearInterval(recheckTimer);
        document.removeEventListener('selectionchange', onSelectionChange);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onWindowScroll);
        window.removeEventListener('blur', onWindowBlur, true);
        window.removeEventListener('focus', onWindowFocus, true);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('mouseup', onMouseUp);
        if (observer) observer.disconnect();
        if (measureRafRef.current) {
          if (typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(measureRafRef.current);
          }
          measureRafRef.current = 0;
        }
        measureQueuedRef.current = false;
        if (measureTimerRef.current) {
          window.clearTimeout(measureTimerRef.current);
          measureTimerRef.current = 0;
        }
        if (noticeTimerRef.current) {
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = 0;
        }
        flushNow(); // last chance: never lose a debounce window
      };
    }, []);

    // Typography / theme / width changes: re-measure and re-fit after layout.
    React.useEffect(() => {
      if (!taRef.current) return;
      invalidateAutosize();
      // Font size, line height and (im)mersive width all change the column
      // geometry, which can move scrolling to a different element, and the
      // dock lane (it is derived from the page width).
      syncScrollerAndMeasure();
    }, [fontFamily, fontSize, lineHeight, pageWidth, theme, autoSaveMs, typewriterOn, immersive]);

    // Hand the imperative API to the app once.
    React.useEffect(() => {
      const fn = propsRef.current.registerApi;
      if (typeof fn === 'function') {
        try {
          fn(apiRef.current);
        } catch (err) {
          /* parent wiring bug: keep the editor alive */
        }
      }
    }, [p.registerApi]);

    // ---------------------------------------------------------------- render --
    const find = findRef.current;
    const matchTotal = find.matches.length;
    const matchPos = matchTotal ? Math.min(find.index + 1, matchTotal) : 0;
    const countText = find.notice || (find.query ? matchPos + '/' + matchTotal : '');

    const findBar =
      chapter && find.open
        ? h(
            'div',
            {
              className: 'nw-findbar',
              role: 'search',
              'aria-label': NW.t('查找替换'),
            },
            h(
              'div',
              { className: 'nw-find-row' },
              h('input', {
                ref: findInputRef,
                className: 'nw-find-input',
                type: 'text',
                value: find.query,
                placeholder: NW.t('查找') + '…',
                spellCheck: false,
                autoComplete: 'off',
                'aria-label': NW.t('查找'),
                onChange: (ev) => {
                  findRef.current.query = ev.target.value;
                  refreshMatches();
                  scheduleMeasure(false);
                },
                onKeyDown: (ev) => onFindKeyDown(ev, 'find'),
              }),
              h('span', { className: 'nw-find-count', title: countText }, countText),
            ),
            h(
              'div',
              { className: 'nw-find-row' },
              h('input', {
                ref: replaceInputRef,
                className: 'nw-find-input',
                type: 'text',
                value: find.replace,
                placeholder: NW.t('替换为') + '…',
                spellCheck: false,
                autoComplete: 'off',
                'aria-label': NW.t('替换为'),
                onChange: (ev) => {
                  findRef.current.replace = ev.target.value;
                  bumpFind();
                },
                onKeyDown: (ev) => onFindKeyDown(ev, 'replace'),
              }),
            ),
            h(
              'div',
              { className: 'nw-find-actions' },
              mkBtn({
                children: NW.t('上一个'),
                title: NW.t('上一个') + ' (Shift+Enter)',
                onClick: () => stepMatch(-1),
                disabled: !matchTotal,
              }),
              mkBtn({
                children: NW.t('下一个'),
                title: NW.t('下一个') + ' (Enter)',
                onClick: () => stepMatch(1),
                disabled: !matchTotal,
              }),
              mkBtn({
                children: NW.t('替换'),
                title: NW.t('替换'),
                onClick: doReplace,
                disabled: !matchTotal,
              }),
              mkBtn({
                children: NW.t('全部替换'),
                title: NW.t('全部替换'),
                onClick: replaceAll,
                disabled: !find.query,
              }),
              h('span', { className: 'nw-find-spacer' }),
              mkBtn({
                children: NW.t('关闭'),
                title: NW.t('关闭') + ' (Esc)',
                onClick: () => closeFind(),
              }),
            ),
          )
        : null;

    const body = chapter
      ? h(
          'div',
          { className: 'nw-page', ref: pageRef },
          showTitle
            ? h('div', { className: 'nw-chaptertitle', ref: titleRef, role: 'heading', 'aria-level': 1 }, chapterTitle)
            : null,
          h(
            'div',
            { className: 'nw-stack', ref: stackRef },
            h('div', { className: 'nw-hl', ref: hlRef, 'aria-hidden': 'true' }),
            h('div', { className: 'nw-caret', ref: caretRef, 'aria-hidden': 'true' }),
            // Thick caret: painted from the same mirror measurement the
            // typewriter uses, so its line always matches the centred one.
            // data-visible is owned imperatively by paintCaret() (it flips on
            // focus/selection/IME); it is deliberately NOT declared as a JSX
            // prop so React never resets the attribute on an unrelated render.
            h('div', { className: 'nw-cursor', ref: cursorRef, 'aria-hidden': 'true' }),
            h('textarea', {
              ref: taRef,
              className: 'nw-ta',
              rows: 1,
              wrap: 'soft',
              spellCheck: false,
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'off',
              // Grammarly (and similar extensions) inject overlays into the
              // textarea and re-scan on every keystroke; this opt-out is what
              // keeps typing smooth for users who have them installed.
              'data-gramm': 'false',
              'data-gramm_editor': 'false',
              'data-enable-grammarly': 'false',
              // Uncontrolled, but pre-filled so the first paint already has the
              // text (the mount effect then only re-affirms the same value).
              defaultValue: chapter && typeof chapter.content === 'string' ? chapter.content : '',
              'aria-label': NW.t('正文'),
              onInput: handleInput,
              onKeyDown: handleKeyDown,
              onKeyUp: () => scheduleMeasure(true),
              onMouseDown: () => {
                // Suppress re-centring until mouseup so a drag-selection is not
                // fought by the script while the pointer is still down.
                draggingRef.current = true;
              },
              onBlur: handleBlur,
              onFocus: () => scheduleMeasure(false),
              onClick: () => scheduleMeasure(true),
              onCompositionStart: handleCompositionStart,
              onCompositionEnd: handleCompositionEnd,
              onSelect: () => scheduleMeasure(true),
            }),
          ),
        )
      : h(
          'div',
          { className: 'nw-empty' },
          h('div', { className: 'nw-empty-glyph' }, '\u270E'),
          h('div', { className: 'nw-empty-main' }, NW.t('从左侧选择或新建一个章节开始写作')),
          h(
            'div',
            { className: 'nw-empty-sub' },
            NW.t('Ctrl+F 查找 · Ctrl+S 保存 · Tab 缩进'),
          ),
        );

    return h(
      'div',
      {
        className: 'nw-surface',
        ref: surfaceRef,
        'data-theme': theme,
        'data-typewriter': typewriterOn ? '1' : '0',
        'data-immersive': immersive ? '1' : '0',
        // R10: the 灵感便签 column floats over the same right edge as the dock,
        // so applyDockLane() widens the reserved lane while it is mounted. The
        // CSS attribute (not the prop) is what the timer callbacks read.
        'data-notes-lane': notesLane ? '1' : '0',
        // R11: caret blink is a setting; the attribute is what the CSS rule reads
        // (paintCaret rewrites animation-name, so an inline style would be undone).
        'data-caret-blink': caretBlink ? '1' : '0',
        // Filled in by syncScroller(): 'self' | 'ancestor' | 'document'.
        // Diagnostics: tells you which element typewriter mode actually drives.
        'data-scroller': scrollerKind,
        style: surfaceStyle,
      },
      h('div', { className: 'nw-scroll', ref: scrollRef, tabIndex: -1 }, body),
      findBar,
      onHome || onToggleShelf || onLock
        ? h(
            'div',
            { className: 'nw-surface-acts' },
            onHome
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-homebtn',
                    title: NW.t('回到首页'),
                    'aria-label': NW.t('回到首页'),
                    onClick: (ev) => {
                      // Blur first: leaving the textarea while a save is pending
                      // would otherwise re-enter this handler through the blur flush.
                      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                      onHome();
                    },
                  },
                  // `home` lives in 42-icons.js — reusing it keeps the stroke
                  // weight and optical size identical to the shelf icons.
                  // NOTE: NW.icon is a plain function (name, opts), not a
                  // component — h(NW.icon, {name}) would pass the props object
                  // as `name` and draw an empty svg (that is exactly the "three
                  // blank buttons" bug).
                  NW.icon('home', { size: 16 }),
                )
              : null,
            onToggleShelf
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-actbtn',
                    title: shelfOpen ? NW.t('隐藏目录') : NW.t('显示目录'),
                    'aria-label': shelfOpen ? NW.t('隐藏目录') : NW.t('显示目录'),
                    'aria-expanded': shelfOpen ? 'true' : 'false',
                    onClick: (ev) => {
                      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                      onToggleShelf();
                    },
                  },
                  NW.icon(shelfOpen ? 'chevleft' : 'chevright', { size: 16 }),
                )
              : null,
            onLock
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nw-actbtn',
                    title: NW.t('锁定'),
                    'aria-label': NW.t('锁定'),
                    onClick: (ev) => {
                      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                      onLock();
                    },
                  },
                  NW.icon('lock', { size: 16 }),
                )
              : null,
          )
        : null,
    );
  };
})();
