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
  // R68: how long a sideways arrow keeps the typewriter gentle ('nearest'
  // instead of 'centre'). Long enough to cover a burst of held arrows, short
  // enough that the next keystroke re-centres immediately.
  const CARET_NAV_EASE_MS = 400;
  // How long after the last keystroke a peer's edit may still take the caret
  // with it. Long enough to cover a pause for thought in the middle of a
  // sentence, short enough that someone watching the screen (typing on the
  // phone instead) gets taken to the change instead of being left behind.
  const PEER_FOLLOW_IDLE_MS = 3000;
  const MEASURE_MS = 60; // caret measurement / autosize throttle
  const TAB_TEXT = '\u3000\u3000'; // two full-width spaces
  const MAX_MATCHES = 5000;
  // R47: the annotation kinds the editor knows how to draw. Each one becomes a
  // `nw-mark-<kind>` class on the mirror `<mark>`, so the look of a mark lives
  // in CSS next to the highlight mirror rather than in this function.
  // R48 dropped 待改: a mark that is neither "this line is good" nor "this line
  // goes" is a note, and the note kind already carries a paragraph of text.
  const MARK_CLASS = { underline: 1, strike: 1, comment: 1 };
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

  /**
   * The single region that differs between two versions of the buffer.
   *
   * Returns the common head, the common tail, and the two middle lengths, so
   * callers can either shift a caret through the edit (`shiftOffsetForEdit`)
   * or scroll to it (`adoptExternalText`). Both need the same answer, and
   * computing it twice would mean two full scans of a 200k-character chapter.
   */
  function diffEnds(before, after) {
    const a = typeof before === 'string' ? before : '';
    const b = typeof after === 'string' ? after : '';
    const max = Math.min(a.length, b.length);
    let head = 0;
    while (head < max && a.charCodeAt(head) === b.charCodeAt(head)) head += 1;
    const tailMax = max - head;
    let tail = 0;
    while (
      tail < tailMax &&
      a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)
    ) {
      tail += 1;
    }
    return { head, tail, oldMid: a.length - head - tail, newMid: b.length - head - tail };
  }

  /**
   * Maps a buffer offset through a wholesale text replacement.
   *
   * When a peer rewrites the chapter we still have to put the caret somewhere.
   * Dropping it at the end — the obvious choice — sends the writer to the last
   * line of a chapter they were reading in the middle: the phone's edit looked
   * like it "jumped to the end". Keeping the raw offset is also wrong whenever
   * the edit landed above the caret, because the caret would then point at a
   * different character. Shifting it by the size of the replaced middle region
   * keeps it on the character the writer was sitting on.
   */
  function shiftOffsetForEdit(before, after, offset) {    const a = typeof before === 'string' ? before : '';
    const b = typeof after === 'string' ? after : '';
    const at = clampNum(Math.round(numOf(offset, 0)), 0, a.length);
    if (a === b) return clampNum(at, 0, b.length);
    const d = diffEnds(a, b);
    if (at <= d.head) return at;
    if (at >= d.head + d.oldMid) return clampNum(at + (d.newMid - d.oldMid), 0, b.length);
    return clampNum(d.head + d.newMid, 0, b.length);
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
  /* R46: what the rest of the page fades towards while writing. Mixing the
     paper colour keeps every theme consistent — moon/night themes fade towards
     a dark ink instead of washing the text to white. R54: unchanged on purpose.
     The writer asked for "that kind of effect" in normal mode too, so the wash
     strength has to be the one they already liked in immersive mode. */
  --nw-veil-ink:color-mix(in srgb, var(--nw-bg) 72%, transparent);
  /* R46: one line of feather, derived from the letter size, so the band edge lands
   on the line box instead of in the middle of one. */
  --nw-focus-feather:calc(var(--nw-size) * var(--nw-line,2));
}
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

/* ---- chapter heading (R17 ①, reworked R19, editable R41) -----------------
   The chapter name is printed as the first line of the manuscript, centred and
   larger than the body. It lives inside .nw-page above .nw-stack so it scrolls
   with the text, and it stays OUT of the textarea so that typing never risks
   eating the heading. Its height is measured by chapterTitleH() and subtracted
   from the typewriter room.

   R19: this used to be 700-weight, which read like a government notice. A book
   heading is quieter than the body, not louder: semibold, a hair of tracking,
   and a short centred rule that spans the title only. The rule is a pseudo
   element, not a border on the block, so it never stretches the full measure.

   R41: the heading is now the writer's own field (contenteditable, see
   handleTitleKeyDown) instead of a shelf-only label. Everything measurable --
   padding, margin, font-size, line-height -- must stay identical in every
   state, because chapterTitleH() feeds the typewriter room; the editable
   affordances below therefore use box-shadow (no layout cost), never borders
   or padding. */
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
  cursor:text;
  transition:box-shadow .12s ease;
}
.nw-chaptertitle:hover{box-shadow:inset 0 0 0 1px var(--nw-rule);}
.nw-chaptertitle:focus{outline:none;box-shadow:inset 0 0 0 1px var(--nw-rule);}
/* Keyboard users still get a visible ring; the mouse-only cue above is the
   hairline. */
.nw-chaptertitle:focus-visible{outline:2px solid var(--nw-fg);outline-offset:4px;}
.nw-chaptertitle[data-empty="1"]{color:var(--nw-soft);}
.nw-chaptertitle[data-empty="1"]:empty::before{
  content:attr(data-placeholder);
  color:var(--nw-soft);
  opacity:.7;
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
   right of the writing pane (CONTRACT-R3 section 7).

   R69: 两端对齐. Justified text stretches every line except a paragraph's last
   one, and text-align-last:left is what keeps that last line honest — without
   it the final line of every paragraph would be stretched by its few trailing
   glyphs, which looks broken in CJK. All three layers must carry both
   declarations: the caret mirror measures glyph positions, so a textarea that
   justifies while the mirror does not would put the caret at the wrong x on
   every line (measured: 66 of 84 offsets off, drifting up to a full line
   width). */
.nw-ta,.nw-hl,.nw-caret{
  box-sizing:border-box;display:block;width:100%;margin:0;border:0;
  padding:0 calc(var(--nw-pad-x) + var(--nw-gutter-x,0px));
  font-family:var(--nw-font);font-size:var(--nw-size);font-weight:400;font-style:normal;
  line-height:var(--nw-line);letter-spacing:0;word-spacing:0;
  text-align:justify;text-align-last:left;text-indent:0;
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
/* R47: annotations. They are drawn by the same mirror as the advice highlight —
   the textarea above stays perfectly transparent, so a mark never changes the
   colour of the words or the flow of the line, only the paper under it. */
.nw-hl .nw-mark-underline{
  background-color:transparent;
  box-shadow:inset 0 -2px 0 var(--nw-mark-underline, var(--nw-brand));
}
.nw-hl .nw-mark-strike{
  background-color:transparent;
  /* R53d：这一行是「删除线底下多出一道下划线」的根因。镜像里的每个标注都带
     .nw-hl-mark，而 .nw-hl .nw-hl-mark 自带一条 inset 底边（那是给 AI 建议高亮
     用的）。下划线和批注各自重写了 box-shadow，删除线只清了底色、没清阴影，于是
     继承下来的底边就在中线之外又画了一道线。 */
  box-shadow:none;
  text-decoration:line-through;
  text-decoration-color:var(--nw-mark-strike, var(--nw-danger));
  text-decoration-thickness:2px;
  text-decoration-thickness:max(2px, .09em);
}
/* The words of a struck line are still the manuscript's words: they stay fully
   legible (no faded filler) until the writer actually deletes them. The mirror
   paints every glyph transparent, so the strike is drawn with text-decoration
   on the transparent run — which is why the mark keeps its own colour clear. */
.nw-hl .nw-mark-comment{
  position:relative;
  background-color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 16%, transparent);
  box-shadow:inset 0 -1px 0 var(--nw-mark-comment, var(--nw-brand));
}
/* R53：写作区不再在字里插角标。原先那个小方框（.nw-mark-dot）虽然零宽，但
   它画在字尾右上角，行距紧的时候仍然压住上一行的字脚；而且它跟着镜像走，一
   重排就得重画。改成页边批注签（.nw-mark-gutter / .nw-mark-side）：签挂在纸
   的右外侧，正文上只留下那条线本身，字一个也不动。 */
.nw-hl .nw-mark-comment[data-active="1"],
.nw-hl .nw-mark-underline[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 30%, transparent);
  box-shadow:inset 0 -1px 0 var(--nw-brand);
}
/* 删除线的「点开」只加底色，不补底边——它身上已经有一条穿字而过的线，再加一道
   底边就又成了「删除线附带下划线」，和正常状态那个 bug 是同一个。 */
.nw-hl .nw-mark-strike[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 30%, transparent);
  box-shadow:none;
}
/* 页边批注签的容器：盖在纸面上、不接事件（只有签本身接），这样正文的点击、
   选区、拖拽全都不受影响。overflow:hidden 是为了签从纸边滑出去时被裁掉，
   而不是漂到纸外面挂着。 */
.nw-mark-gutter{
  position:absolute;left:0;top:0;right:0;bottom:0;
  z-index:var(--nw-z-float);
  overflow:hidden;pointer-events:none;
}
/* 一枚签 = 一条带批注的线。签上写**章内序号**（按 start 排序），同一行挂两条
   批注、两枚签上下错开之后，序号是唯一能分辨谁是谁的线索；鼠标停上去再点亮
   它指的那句，序号和句子就配上了。 */
.nw-mark-side{
  position:absolute;
  box-sizing:border-box;width:16px;height:16px;padding:0;
  display:flex;align-items:center;justify-content:center;
  border:0;border-radius:4px;cursor:pointer;pointer-events:auto;
  font-family:var(--nw-ui-font);font-size:9px;line-height:1;
  font-variant-numeric:tabular-nums;
  color:var(--nw-panel);
  background:var(--nw-mark-comment, var(--nw-brand));
  box-shadow:0 0 0 1px color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 24%, transparent);
  transition:transform .12s, opacity .12s;
  opacity:.9;
}
.nw-mark-side:hover{transform:scale(1.14);opacity:1;}
.nw-mark-side[data-active="1"]{opacity:1;box-shadow:0 0 0 2px color-mix(in srgb, var(--nw-brand) 40%, transparent);}
.nw-mark-side:focus-visible{outline:2px solid var(--nw-brand);outline-offset:1px;opacity:1;}
/* R53c：不再画引线。用户说那条细线在页边空白里看不出来，两条签错开时更像
   装饰。改成让**句子自己**回答：鼠标停在签上、或点开一条批注时，它指的那句
   明显变色（见下面的 [data-hover] 与 mark[data-active]）。 */
/* 悬停时点亮签所指的那条线。R53c：14% 太轻，提到 26% 再加一道 2px 底边，
   隔着一页也能一眼扫到是哪句。 */
.nw-hl .nw-mark-comment[data-hover="1"],
.nw-hl .nw-mark-underline[data-hover="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 26%, transparent);
  box-shadow:inset 0 -2px 0 var(--nw-brand);
}
/* R53d：删除线悬停时同样只加底色——补底边就又变成「删除线附带下划线」。 */
.nw-hl .nw-mark-strike[data-hover="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 26%, transparent);
  box-shadow:none;
}
/* R51：写作时点一条线，浮出这张小卡：引文、批注原文、一个删除。这里是**看**的地方，
   所以没有输入框——批注在写作区只读，要改它回「读一遍」里改。卡片的坐标由
   openMarkView() 按点击处算好，夹在纸面之内。 */
.nw-mark-view{
  position:absolute;z-index:var(--nw-z-panel);
  width:min(200px,calc(100% - 24px));
  display:flex;flex-direction:column;gap:4px;
  padding:6px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);background:var(--nw-panel);box-shadow:var(--nw-shadow-2);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);line-height:1.45;
}
/* R53g：卡片上不再有引文（那句字就在正文里亮着），这条规则留着的唯一作用是
   提醒别再把 quote 加回来；实际已无人使用，删掉。 */
.nw-mark-view-note{color:var(--nw-fg);white-space:pre-wrap;overflow-wrap:break-word;max-height:96px;overflow-y:auto;}
.nw-mark-view-note[data-empty="1"]{color:var(--nw-soft);}
/* R53f：下划线 / 删除线点开只有「删除」，所以卡片不能再用 200px 的批注版宽度——
   一个 22px 高的按钮摊在 200px 里，右边空出一大片，看着像没加载完。收成贴着按钮
   的宽度，两个角跟按钮同圆角，像从那条线上长出来的一枚小标签。 */
.nw-mark-view[data-compact="1"]{
  width:auto;min-width:0;padding:4px;gap:0;
  border-radius:var(--nw-r-control);
}
.nw-mark-view[data-compact="1"] .nw-mark-view-acts{gap:0;}
.nw-mark-view[data-compact="1"] .nw-mark-view-btn{flex:0 0 auto;padding:0 12px;}
.nw-mark-view-acts{display:flex;gap:4px;}
.nw-mark-view-btn{
  flex:1 1 auto;height:22px;padding:0 8px;
  border-radius:var(--nw-r-control);border:1px solid var(--nw-line-strong);
  background:var(--nw-btn-bg);color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);white-space:nowrap;
}
.nw-mark-view-btn:hover{background:var(--nw-btn-hover);}
.nw-mark-view-btn[data-danger="1"]{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 45%, var(--nw-line-strong));}
/* R53c：写作区不再有「标记」按钮。左上角那颗铅笔被用户点名去掉了——它常驻在
   纸面上方，占着一格视觉重量，而标注是低频动作。现在入口改成**右键**：选中一段
   字，按右键才弹出这张小菜单（浏览器原生菜单被拦下），没选中就还是原生菜单，
   复制粘贴照旧。看不见的入口，也就不会碍眼。 */
.nw-mark-menu{
  position:absolute;z-index:var(--nw-z-float);
  display:flex;flex-direction:column;gap:1px;
  width:146px;padding:3px;
  border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line-strong);
  background:var(--nw-panel);box-shadow:var(--nw-shadow-2);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  animation:nw-fade-in .1s var(--nw-ease, ease) both;
}
/* 菜单顶上那行小字：有选区就显示要标的那几个字，没选区就说清楚为什么按不动。 */
.nw-mark-menu-quote{
  max-width:100%;padding:0 4px 3px;
  color:var(--nw-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-mark-menu-btn{
  display:flex;align-items:center;gap:7px;
  height:26px;padding:0 7px;border:0;border-radius:var(--nw-r-hair);
  background:transparent;color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);text-align:left;white-space:nowrap;
}
.nw-mark-menu-btn:hover{background:var(--nw-btn-hover);}
.nw-mark-menu-btn:disabled{opacity:.42;cursor:default;background:transparent;}
/* 菜单里的样本：一段 20px 宽的假字，用真实的那种线画出来，选之前就能看见结果。 */
.nw-mark-menu-swatch{
  flex:0 0 auto;width:20px;height:14px;
  border-radius:2px;
  background:color-mix(in srgb, var(--nw-fg) 12%, transparent);
}
.nw-mark-menu-swatch[data-kind="underline"]{
  box-shadow:inset 0 -2px 0 var(--nw-mark-underline, var(--nw-brand));
}
.nw-mark-menu-swatch[data-kind="strike"]{
  background-image:linear-gradient(to bottom, transparent calc(50% - 1px), var(--nw-mark-strike, var(--nw-danger)) calc(50% - 1px), var(--nw-mark-strike, var(--nw-danger)) calc(50% + 1px), transparent calc(50% + 1px));
}
.nw-mark-menu-swatch[data-kind="comment"]{
  background:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 16%, transparent);
  box-shadow:inset 0 -1px 0 var(--nw-mark-comment, var(--nw-brand));
}

/* caret measuring mirror: same box, never painted */
.nw-caret{
  position:absolute;left:0;top:0;width:100%;height:auto;overflow:visible;
  visibility:hidden;pointer-events:none;user-select:none;z-index:var(--nw-z-base);
}
/* the tail of the manuscript that follows the caret; its first rect is the
   caret. It must stay a plain inline span — an inline-block would open a new
   break opportunity before the caret and change the line breaking. */
.nw-caret-rest{display:inline;}

/* ---- R46 line focus ----
   A textarea cannot fade a range of its own lines, so the fade is drawn as two
   veils laid over the text: one from the top of the page down to the line the
   writer is on, one from there to the bottom. Their geometry comes from the
   same caret measurement the typewriter already runs, which means the band
   tracks wrapped lines for free and costs no second geometry pipeline.
   The veils live in .nw-surface (which does not scroll), not in .nw-scroll, so
   their heights are viewport coordinates computed from the cached content-space
   line top minus scrollTop — scrolling therefore repaints the band without
   measuring anything.
   z-index 1 keeps them above the transparent textarea (base) and below the
   thick caret (float), so the caret never sits under a veil.

   R54: in normal mode the surface is wider than the paper (shelf + desk
   margins), so a full-bleed veil would dim the desk around the sheet too and
   the page would look like a hole cut in a grey card. [data-immersive="0"]
   therefore insets the wash to the page column; immersive mode keeps the
   full-bleed version it has always had, because there the column nearly IS the
   pane and the writer already approved that look. --nw-width is the same
   value .nw-page is sized with (written by the component), so the two edges
   agree to the pixel. */
.nw-veil{
  position:absolute;left:0;right:0;pointer-events:none;user-select:none;
  z-index:1;display:none;
}
.nw-surface[data-immersive="0"] .nw-veil{
  left:calc(50% - min(var(--nw-width,760px),100%) / 2);
  right:calc(50% - min(var(--nw-width,760px),100%) / 2);
}
.nw-surface[data-focus="1"] .nw-veil{display:block;}
.nw-veil-top{
  top:0;height:0;
  background:linear-gradient(to bottom,var(--nw-veil-ink) 0,var(--nw-veil-ink) calc(100% - var(--nw-focus-feather)),transparent 100%);
}
.nw-veil-bot{
  top:0;bottom:0;
  background:linear-gradient(to top,var(--nw-veil-ink) 0,var(--nw-veil-ink) calc(100% - var(--nw-focus-feather)),transparent 100%);
}
@media (prefers-reduced-motion: reduce){
  /* The band is geometry, not motion — it stays. Nothing animates here. */
  .nw-veil{transition:none;}
}

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
  display:inline-flex;align-items:center;gap:0;
  /* R27 ①: the notes lane used to be a left padding on the writing column,
     which slid the whole surface (and this row, anchored to its left edge)
     348px to the right the moment the card opened — the buttons appeared to
     jump onto the paper. The lane is now an inset on the surface itself, so the
     surface keeps the column's real left edge and this row simply never moves.

     R30: three loose squares in a row read as three unrelated buttons, and the
     lock — a destructive action — sat one 4px gap away from the shelf toggle.
     They were merged into one segmented capsule.
     R33: the shelf toggle is gone (首页 restores the shelf), so the capsule now
     holds two things — navigation | a hairline | the lock. */
  padding:3px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-btn-border);background:var(--nw-panel);
  box-shadow:var(--nw-shadow-1);
}
.nw-acts-div{
  width:1px;height:16px;margin:0 var(--nw-sp-0);
  background:var(--nw-btn-border);flex:0 0 auto;
}
.nw-homebtn,
.nw-actbtn{
  display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border-radius:var(--nw-r-pill);border:1px solid transparent;
  background:transparent;color:var(--nw-btn-fg);
  font-family:inherit;font-size:12px;line-height:1;cursor:pointer;
  /* R21: 0.55 was meant as "quiet until hovered", but on the warm palettes it
     reads as disabled — the glyph sits at ~45% contrast against the paper and
     the writer has to hunt for it. 0.78 is still clearly secondary next to the
     body text while staying legible; hover takes it to 1.
     R30: the individual borders moved onto the enclosing capsule, so these are
     now just the glyph wells; the hover fill carries the affordance. */
  opacity:.78;transition:opacity var(--nw-dur) ease,background var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-homebtn:hover,
.nw-actbtn:hover{opacity:1;background:var(--nw-btn-hover);border-color:transparent;}
.nw-homebtn:focus-visible,
.nw-actbtn:focus-visible{opacity:1;outline:2px solid var(--nw-find-ring);outline-offset:1px;}
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
    // R33: 首页 also reopens the shelf, because the home screen is where you pick
    // a book — landing there with the目录 still hidden made the button feel broken.
    const onHome = typeof p.onHome === 'function' ? p.onHome : null;
    // R16 ③: the lock button lives next to the home button so the writing surface
    // keeps its own controls even when DSH chrome is hidden (immersive).
    const onLock = typeof p.onLock === 'function' ? p.onLock : null;
    // R22: keyboard shortcuts for the two most common structural actions. The
    // editor owns the keystrokes because it has focus; the app owns the actions.
    const onNewChapter = typeof p.onNewChapter === 'function' ? p.onNewChapter : null;
    const onToggleAdvice = typeof p.onToggleAdvice === 'function' ? p.onToggleAdvice : null;
    // R41 ①: the heading is now the writer's own input. The app owns the row
    // (its list, its database write and the toast on failure); the editor only
    // parses the keystrokes and reports the new string back.
    const onRenameTitle = typeof p.onRenameTitle === 'function' ? p.onRenameTitle : null;
    /** 灵感便签 lane (R10): the app mounts the notes column beside the text. */
    const notesLane = p.notesLane === true && !immersive;
    /** Page width actually applied; immersive mode guarantees a wide canvas. */
    const effPageWidth = immersive ? Math.max(pageWidth, 880) : pageWidth;

    const chapter = p.chapter || null;
    const chapterId = chapter && chapter.id != null ? chapter.id : null;

    // R17 ①: the chapter name is printed as the first line of the manuscript,
    // centred and larger than the body. Declared here (not next to the JSX)
    // because the measuring effects below depend on it.
    //
    // R41 ①: the heading is no longer hidden for placeholder titles. It used to
    // disappear whenever the row said "新章节", which meant the auto-created
    // chapter had no rename entry point at all once you were inside it. Now the
    // block is always mounted and merely dims (data-empty) with a hint, so the
    // first thing a writer can do in a fresh chapter is click the title.
    const chapterTitle = chapter ? String(chapter.title || '').trim() : '';
    const titlePlaceholder = !chapterTitle || isPlaceholderTitle(chapterTitle);

    // ---- caret appearance (R11): width / colour / blink are user settings ----
    // The palette still owns `--nw-caret-color` per theme, so an empty
    // `settings.caretColor` means "follow the theme"; anything else overrides it.
    const caretWidth = clampNum(numOf(settings.caretWidth, 3), 1, 8);
    const caretColor = String(settings.caretColor == null ? '' : settings.caretColor).trim();
    const caretBlink = settings.caretBlink !== false;

    // ---- R46 line focus ------------------------------------------------------
    // Fading everything except the line being written keeps the sentence in
    // front of the eye without touching the manuscript, the theme or the flow
    // of the text. Two lines of context each way is the default: about what a
    // writer can still read without moving their eyes.
    //
    // R54: this used to be immersive-only, on the theory that with the shelf
    // and toolbar on screen a fade would "fight the chrome". The writer
    // disagrees — the fade is about the page, not about the chrome, and a
    // manuscript that dims itself around the caret is just as useful with the
    // shelf open. So it now follows the setting alone (`focusDim`, on by
    // default, switchable off in 设置 → 写作), in both modes.
    //
    // R54b: the band is anchored to the MIDDLE of the pane, not to the caret's
    // line — and the caret is brought into that band. The first attempt followed
    // the caret, which is only right while you are typing: open a chapter and
    // the caret sits on line one, so the light lands at the top of the page and
    // the writer stares at a whole pane of dimmed text until they click
    // something. Anchoring to the middle is what makes it read as "the
    // paragraph I am on"; planBandScroll() then keeps the caret inside the lit
    // band, so the two can never disagree. It is also cheaper: the band stops
    // moving on every keystroke, so typing no longer repaints it.
    const focusOn = settings.focusDim !== false;
    const focusLines = clampNum(numOf(settings.focusLines, 2), 0, 8);
    // Whether the caret has to be pushed into the band (see focusCenter()).
    // This is what typewriter mode has always done, so a writer who turned that
    // off has said "leave my viewport alone" — the fade then simply lights the
    // middle of the page and the caret may sit anywhere, which is the pre-R54
    // behaviour and is still the right trade-off for those users.
    const focusFollows = focusOn && settings.typewriter !== false;

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
    // R41 ①: the title last accepted by the app. Escape restores it, and it is
    // reset on every chapter switch so a stale string can never be restored
    // into a different chapter.
    const titleSavedRef = React.useRef('');
    const titleBusyRef = React.useRef(false);
    const stackRef = React.useRef(null);
    const hlRef = React.useRef(null);
    const caretRef = React.useRef(null);
    // The painted thick caret (positioned by paintCaret from measureCaret).
    const cursorRef = React.useRef(null);
    // R46: the two veils that fade everything but the line being written.
    const veilTopRef = React.useRef(null);
    const veilBotRef = React.useRef(null);
    // Content-space top of the caret's line, written by every measure pass.
    // Scrolling does not change it, which is what lets a scroll event repaint
    // the fade without measuring anything. -1 means "not measured yet".
    const focusTopRef = React.useRef(-1);
    // Pending frame for that repaint (0 = none queued).
    const focusRafRef = React.useRef(0);
    const findInputRef = React.useRef(null);
    const replaceInputRef = React.useRef(null);

    const propsRef = React.useRef(p);
    propsRef.current = p;
    const cfgRef = React.useRef(null);
    cfgRef.current = { autoSaveMs, typewriterOn, fontSize, lineHeight, focusOn, focusLines, focusFollows };

    const highlightsRef = React.useRef([]);
    // R47: persistent annotations, kept apart from `highlightsRef` on purpose —
    // the advice panel owns that one and clears it whenever the writer moves on,
    // and it must not be able to wipe the writer's own underlines.
    const marksRef = React.useRef([]);
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
    // R68: last time the caret moved sideways (ArrowLeft/ArrowRight). Unlike
    // manualAtRef it does not freeze the viewport — it only downgrades the
    // typewriter from 'center' to 'nearest' for a moment, so the page stays
    // put while the writer arrows along a line and still follows when typing.
    const caretNavAtRef = React.useRef(-1e9);
    // Last time the caret moved because this writer typed here. Distinguishes
    // "someone is writing in this pane" from "this pane is just being watched".
    const typedAtRef = React.useRef(-1e9);
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
    /** R52: where the current press started, so a click can be told from a drag. */
    const pointerDownRef = React.useRef(null);
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
    // R51: the little card that shows what a line says when the writer clicks
    // it. Reading happens in the writing surface too — that is where the line
    // is, after all — but it is read-only here: 读一遍 is where a note is written.
    const [markView, setMarkView] = React.useState(null);
    const markViewRef = React.useRef(null);
    markViewRef.current = markView;
    // R53：写作区不再有「选字弹条」。标注动作收进左上角的动作胶囊：一个铅笔
    // 按钮开一张小菜单（下划线 / 删除线 / 批注）。菜单只认**按下那一刻**的选区，
    // 所以它开着的这段时间里正文选区可以随便变，不会标错地方。
    // R53c：那个按钮撤了，入口改成右键。
    const [markMenu, setMarkMenu] = React.useState(null);
    const markMenuRef = React.useRef(null);
    markMenuRef.current = markMenu;
    /** 页边批注签的容器（.nw-mark-gutter），由 paintGutter() 直接填 DOM。 */
    const gutterRef = React.useRef(null);

    // R53c：菜单现在从右键弹出（没有常驻按钮了）。按下菜单以外的任何地方、
    // 或按 Escape 都会收起。捕获阶段监听，这样在纸面上按下开始选字时也能先
    // 把菜单清掉。
    React.useEffect(() => {
      if (!markMenu) return undefined;
      const onDown = (ev) => {
        const t = ev.target;
        if (t && typeof t.closest === 'function' && t.closest('.nw-mark-menu')) return;
        closeMarkMenu();
      };
      const onKey = (ev) => {
        if (ev.key !== 'Escape') return;
        closeMarkMenu();
      };
      document.addEventListener('mousedown', onDown, true);
      window.addEventListener('keydown', onKey, true);
      return () => {
        document.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('keydown', onKey, true);
      };
    }, [markMenu]);
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
     * width, padding, white-space:pre-wrap and word-break, so it wraps at the
     * same points as the real text.
     *
     * R69: the mirror holds the prefix in a text node followed by a <span>
     * carrying the *rest* of the value, and the caret is the span's first client
     * rect. An earlier version put a zero-width inline-block marker after the
     * prefix, which was wrong at every soft wrap: a zero-width box can always
     * squeeze onto the previous line's leftover space, so at a wrap boundary the
     * marker reported the end of line N while the real caret sits at the start
     * of line N+1 — measured as exactly one line and one line's width of error
     * (+208px x, -28px y at a 13-glyph line). That is the "一格跨过标点和一个
     * 汉字" report. A span with real text cannot squeeze, so its first rect is
     * the caret. Verified against the browser's own selection highlight at 322
     * offsets across 8 cases (both alignments, blank lines, trailing newline):
     * 100% within 1px, max 0.3px horizontal, 0.5px vertical.
     *
     * The mirror is updated *incrementally*: typing appends to the previous
     * prefix, so we rewrite the prefix text node and the span's tail instead of
     * rebuilding nodes per keystroke (the dominant cost when typing fast).
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
      const prefix = text.slice(0, at);
      // The tail must never be empty or the span would have no line box at all
      // (an empty inline has zero height and reports a 0-height rect).
      const rest = text.slice(at) || '\u200b';

      const prev = mir.__nwPrefix;
      let span = mir.__nwRest;
      const reusable =
        span && typeof prev === 'string' && (prev === prefix || prefix.indexOf(prev) === 0);
      if (reusable) {
        // Typing / one arrow key: only the two text runs change, the nodes stay.
        const first = mir.firstChild;
        if (first && first.nodeType === 3) first.nodeValue = prefix;
        else if (prefix) mir.insertBefore(document.createTextNode(prefix), span);
        span.textContent = rest;
      } else {
        clearNode(mir);
        if (prefix) mir.appendChild(document.createTextNode(prefix));
        span = document.createElement('span');
        span.className = 'nw-caret-rest';
        span.textContent = rest;
        mir.appendChild(span);
        mir.__nwRest = span;
      }
      mir.__nwPrefix = prefix;

      // The span begins exactly at the caret and carries the rest of the
      // manuscript, which is what keeps the mirror's line breaking (and, under
      // text-align:justify, its line stretching) identical to the textarea's.
      // Its first client rect is therefore the caret.
      const rects = span.getClientRects();
      const rect = rects.length ? rects[0] : span.getBoundingClientRect();
      const mirRect = mir.getBoundingClientRect();
      const height = lineHeightPx();
      // A rect on an inline span reports the content box, not the line box; the
      // caret is painted at full line-height, so lift the top by half-leading.
      const halfLead = Math.max(0, (height - rect.height) / 2);
      const left = rect.left - mirRect.left;
      const lineTop = rect.top - mirRect.top - halfLead;
      if (v.kind === 'document') {
        return { top: rect.top - halfLead + (sc.scrollTop || 0), height, left, lineTop };
      }
      const scRect = sc.getBoundingClientRect();
      return {
        top: rect.top - halfLead - scRect.top + (sc.scrollTop || 0),
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
        if (e > s) {
          ranges.push({
            start: s,
            end: e,
            id: r.id,
            active: !!r.active,
            kind: 'hl',
            // R47: the mark's type decides how it is drawn (underline / strike /
            // comment). Unknown or missing types fall back to the plain
            // highlight the advice panel has always used.
            mark: MARK_CLASS[r.mark] ? r.mark : '',
          });
        }
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
      const own = marksRef.current || [];
      for (let i = 0; i < own.length; i += 1) {
        const r = own[i];
        if (!r) continue;
        const s = clampNum(numOf(r.start, 0), 0, text.length);
        const e = clampNum(numOf(r.end, s), s, text.length);
        if (e > s) {
          ranges.push({
            start: s,
            end: e,
            id: r.id,
            active: !!r.active,
            kind: 'hl',
            mark: MARK_CLASS[r.kind] ? r.kind : 'underline',
          });
        }
      }
      if (!ranges.length) {
        if (hl.firstChild) clearNode(hl);
        paintGutter();
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
        if (r.mark) {
          el.className += ' nw-mark-' + r.mark;
        }
        if (r.active) el.setAttribute('data-active', '1');
        if (r.id !== undefined && r.id !== null) el.setAttribute('data-id', String(r.id));
        el.textContent = text.slice(s, r.end);
        frag.appendChild(el);
        pos = r.end;
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      clearNode(hl);
      hl.appendChild(frag);
      // R53：正文重建完之后画页边签。签不挂在字上，所以正文怎么切分都不影响它。
      paintGutter();
    }

    // ------------------------------------------------------------- refresh --
    function isManuallyScrolling() {
      return nowMs() - manualAtRef.current < TYPEWRITER_RESUME_MS;
    }
    /** R68: the caret was just arrowed sideways, so keep the page still. */
    function isCaretNavEasing() {
      return nowMs() - caretNavAtRef.current < CARET_NAV_EASE_MS;
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
    /**
     * R54b: the line the lit band is centred on, in *scroller content*
     * coordinates, or null when the band is off.
     *
     * The band is a viewport rectangle (middle of the pane), while `m.top` is
     * content-space. Given the current scrollTop the band's content top is
     * `scrollTop + bandViewportTop`, so a caret is inside the band when
     * `m.top` lies between that and `+ bandHeight`.
     */
    function bandContentTop(view) {
      // Settings are read from cfgRef, not from the closure: this is called from
      // listeners created on the first render, and a writer who turns the fade
      // off must not have to reload the panel for it to stop chasing the caret.
      const cfg = cfgRef.current || {};
      const sc = view && view.el;
      if (cfg.focusOn === false || !sc) return null;
      const own = view.kind === 'self';
      const vzH = own
        ? (sc.clientHeight || window.innerHeight || 0)
        : (window.innerHeight || document.documentElement.clientHeight || 0);
      if (vzH <= 0) return null;
      const lh = lineHeightPx();
      const bandLines = numOf(cfg.focusLines, 2) * 2 + 1;
      const bandViewportTop = Math.round((vzH / 2 - (bandLines * lh) / 2) / lh) * lh;
      return {
        top: bandViewportTop + (own ? sc.scrollTop || 0 : 0),
        height: bandLines * lh,
        origin: own ? 0 : bandViewportTop,
        viewH: vzH,
      };
    }

    /**
     * R54b: keeps the caret inside the lit band.
     *
     * This is the piece that makes "the middle of the screen stays bright"
     * safe. With the band anchored to the pane's middle, a caret that sits
     * near the top or bottom of the viewport would be *inside the dimmed
     * part* — you would be typing into grey. So whenever the caret leaves the
     * band the viewport is nudged by exactly the amount needed to put it back,
     * and nothing else: a caret already in the band costs no scroll at all.
     *
     * Deliberately not "always centre the caret": typewriter mode owns that
     * (and can be switched off), and a writer who turned it off asked for the
     * viewport to stay put. This only steps in when the band and the caret
     * would otherwise contradict each other.
     *
     * Returns the scrollTop to write, or null to leave the viewport alone.
     */
    function planBandScroll(view, getM) {
      const cfg = cfgRef.current || {};
      const sc = view && view.el;
      if (cfg.focusFollows === false || !sc) return null;
      const band = bandContentTop(view);
      if (!band) return null;
      const m = getM ? getM() : measureCaret(taRef.current.selectionStart || 0, view);
      if (!m) return null;
      // Inside the band (with one line of feather either side so a caret on the
      // boundary does not trigger a scroll it does not need).
      const slack = lineHeightPx();
      if (m.top >= band.top - slack && m.top + m.height <= band.top + band.height + slack) {
        return null;
      }
      // Put the caret line in the middle of the band. Both terms are content
      // coordinates: band.top is content already, band.height is a viewport
      // length that is identical in both spaces.
      return m.top + m.height / 2 - (band.top + band.height / 2);
    }

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
      // R68: arrowing sideways is caret movement, not writing. Centring on it
      // made one press look like two at a line crossing — the caret's own jump
      // plus a whole line of page sliding under it — so the typewriter drops to
      // 'nearest' while it lasts: the page holds still and only moves if the
      // caret really leaves the viewport. Typing clears the flag (handleInput)
      // and gets the full centre back.
      const mode = cfg.typewriterOn !== false && !isCaretNavEasing() ? 'center' : 'nearest';
      const typedScroll = caretScrollTop(mode, view, getM);
      if (typedScroll != null) return typedScroll;
      // R54b: typewriter off (or the caret already visible) — the band still
      // needs the caret inside it, or the writer types into the dimmed part.
      return planBandScroll(view, getM);
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
     * R46/R54b: places the two veils so that the middle of the pane stays
     * unfaded and everything above and below it fades.
     *
     * R54b changed what this anchors to. It used to follow the caret line,
     * which is right while you are typing and wrong the rest of the time: open
     * a chapter and the caret sits on line one, so the light sat at the top of
     * the page and the writer looked at a pane of dimmed text until they
     * clicked. Anchoring to the middle is what makes it read as "the paragraph
     * I am on"; `focusCenter()` then keeps the caret inside the band, so the
     * two can never disagree. It also stops the band from moving on every
     * keystroke, so typing no longer repaints it.
     *
     * The veils are children of `.nw-surface`, which does not scroll, so their
     * heights are viewport pixels. `origin` is the scroller's top inside
     * `.nw-surface` (read in the measure pass, where a rect was already being
     * taken for the caret).
     */
    function paintFocus(view, origin) {
      const s = surfaceRef.current;
      const topEl = veilTopRef.current;
      const botEl = veilBotRef.current;
      if (!s || !topEl || !botEl) return;
      const sc = view && view.el;
      const cfg = cfgRef.current || {};
      // R54b: the band no longer depends on where the caret is, so it does not
      // need a caret measurement first. That is what makes it appear immediately
      // when a chapter is opened (the caret is on line one and measureCaret may
      // not have run yet), instead of after the first click.
      const parked = cfg.focusOn === false || !sc;
      if (parked) {
        // Hidden veils must not claim a band: data-focus is owned here (not by
        // JSX) so an unrelated re-render cannot switch the fade back on.
        if (s.getAttribute('data-focus') !== '0') s.setAttribute('data-focus', '0');
        return;
      }
      const lh = lineHeightPx();
      // Two coordinate spaces, because `.nw-surface` is what the veils sit in:
      //  - own scroller (`.nw-scroll`): the surface stays put, so the band is a
      //    viewport rectangle and must be clamped to the pane;
      //  - ancestor/document scroller (host slot with auto height): the surface
      //    itself travels with the page, so the band is plain content geometry
      //    and must NOT be clamped to the pane — the scrollport crops it.
      //
      // R54b: the band is the middle of the pane, independent of where the
      // caret happens to be. planBandScroll() below keeps the caret inside it,
      // so the two can never disagree — one anchor, and the thing that moves is
      // the viewport, not the light.
      const own = view.kind === 'self';
      const viewH = own ? sc.clientHeight || window.innerHeight || 0 : Infinity;
      if (viewH <= 0) return;
      const vzH = own
        ? viewH
        : (window.innerHeight || document.documentElement.clientHeight || 0);
      if (vzH <= 0) return;
      // The middle line, snapped to a whole number of lines so the band edges
      // land between lines rather than through a glyph row.
      const bandLines = numOf(cfg.focusLines, 2) * 2 + 1;
      const centerY = Math.round((vzH / 2 - (bandLines * lh) / 2) / lh) * lh;
      const topH = Math.round(clampNum((own ? numOf(origin, 0) : 0) + centerY, 0, vzH));
      const botY = Math.round(clampNum((own ? numOf(origin, 0) : 0) + centerY + bandLines * lh, 0, vzH));
      if (topEl.__nwH !== topH) {
        topEl.style.height = topH + 'px';
        topEl.__nwH = topH;
      }
      if (botEl.__nwY !== botY) {
        botEl.style.top = botY + 'px';
        botEl.__nwY = botY;
      }
      if (s.getAttribute('data-focus') !== '1') s.setAttribute('data-focus', '1');
    }

    /** Where the scrolling element starts inside `.nw-surface`, in px. */
    function surfaceOrigin(view) {
      const sc = view && view.el;
      const s = surfaceRef.current;
      if (!sc || !s) return 0;
      return sc.getBoundingClientRect().top - s.getBoundingClientRect().top;
    }

    /**
     * Repaints the band after a scroll.
     *
     * R54b: still needed, but for a different reason than R46's. The band is
     * now a fixed viewport rectangle, so scrolling does not move it — what
     * scrolling does move is the caret relative to it, and a writer who scrolls
     * the page by hand needs the light to keep sitting where their eyes are,
     * which is the middle of the pane (where it already is). The one thing
     * that genuinely changes is the mapped band position for scrollers whose
     * origin moves (a host slot with auto height scrolls the surface itself),
     * so the repaint is kept, coalesced.
     */
    function repaintFocusSoon() {
      const cfg = cfgRef.current || {};
      if (cfg.focusOn === false) return;
      if (focusRafRef.current) return;
      const run = () => {
        focusRafRef.current = 0;
        const view = resolveScroller(false);
        paintFocus(view, surfaceOrigin(view));
      };
      if (typeof window.requestAnimationFrame === 'function') {
        focusRafRef.current = window.requestAnimationFrame(run);
      } else {
        run();
      }
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
      const focusOrigin = focusOn ? surfaceOrigin(view) : 0;
      // `focusTopRef` is no longer what places the veils (R54b anchors them to
      // the pane's middle), but the shorthand it holds — "the caret's line, in
      // content coordinates" — is still useful as a guard: paintFocus parks the
      // fade when there is no caret to talk about.
      if (focusOn) {
        const fm = getM();
        focusTopRef.current = fm ? fm.top : -1;
      } else {
        focusTopRef.current = -1;
      }
      // ---------- write phase ----------
      autosizeWrite(height);
      if (scrollTarget != null) setScrollTop(scrollTarget, view);
      paintCaret(caretPlan);
      paintFocus(view, focusOrigin);
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
      if (!immediate && lastSavedRef.current !== null && text === lastSavedRef.current) {
        // R26: the buffer is back to what is already on disk (the author typed
        // and then undid it). No write happens, so the app has to be told the
        // text is clean again — otherwise the status bar stays on 未保存 and
        // beforeunload keeps warning about work that no longer exists.
        dirtyRef.current = false;
        const settled = propsRef.current.onDirty;
        if (typeof settled === 'function') {
          try {
            settled(false);
          } catch (err) {
            /* ignore */
          }
        }
        return;
      }
      // R47: annotations are pinned to characters, so a save is also the moment
      // to tell the app how the text moved. Doing it here rather than per
      // keystroke keeps it to one diff per save, and it covers every way the
      // buffer can change (typing, paste, replace-all, IME commit) without
      // hooking each of them. `lastSavedRef` still holds the text of the
      // previous save at this point, which is exactly what the diff needs.
      const previous = lastSavedRef.current;
      if (typeof previous === 'string' && previous !== text && typeof propsRef.current.onMarksShift === 'function') {
        const d = diffEnds(previous, text);
        if (d.oldMid || d.newMid) {
          try {
            propsRef.current.onMarksShift(d);
          } catch (err) {
            /* a broken listener must not lose the save */
          }
        }
      }
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
      typedAtRef.current = nowMs();
      // R26: tell the app the buffer is dirty *now*. The debounce is 1200ms and
      // without this the status bar keeps claiming 已保存 for the whole second
      // after a keystroke — the "dirty" branch in the app was unreachable.
      const notify = propsRef.current.onDirty;
      if (typeof notify === 'function') {
        try {
          notify(true);
        } catch (err) {
          /* a broken listener must not break typing */
        }
      }
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
      const notify = propsRef.current.onDirty;
      if (typeof notify === 'function') {
        try {
          notify(true);
        } catch (err) {
          /* ignore */
        }
      }
      scheduleSave();
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
      rebuildHighlights();
    }

    /**
     * R45: adopt text that arrived from a peer (LAN sync, another device).
     *
     * This is `setEditorText` minus the two things a *background* rewrite must
     * never do:
     * - It does not mark the buffer dirty. Nothing was typed here; the text
     *   arrived because the other device already saved it. Announcing a dirty
     *   buffer made the status bar claim 未保存 and armed a write-back that
     *   could ping-pong the same text between the two machines.
     * - It does not centre the caret. The old path passed `text.length` as the
     *   selection, so the caret landed on the very last character and
     *   typewriter mode dutifully scrolled there — which is exactly the
     *   reported 「手机编辑时，电脑同步后会跳到最后一行」. The caret now stays on
     *   the character the writer was sitting on, and the viewport is only
     *   nudged when that line actually left the screen.
     */
    function adoptExternalText(next) {
      const ta = taRef.current;
      if (!ta) return;
      const text = typeof next === 'string' ? next : '';
      const before = ta.value;
      const d = diffEnds(before, text);
      const caret = shiftOffsetForEdit(before, text, ta.selectionStart || 0);
      // A save queued by earlier typing must not fire afterwards: the buffer no
      // longer holds that text, and writing it would undo the peer's edit.
      cancelSave();
      if (before !== text) ta.value = text;
      valueRef.current = text;
      // The adopted text *is* what is on disk, so the debounced save has
      // nothing to do; recording it also keeps an echo from counting as an edit.
      lastSavedRef.current = text;
      dirtyRef.current = false;
      // A centre request queued before the pull must not fire after it.
      pendingCenterRef.current = false;
      const notify = propsRef.current.onDirty;
      if (typeof notify === 'function') {
        try {
          notify(false);
        } catch (err) {
          /* ignore */
        }
      }
      try {
        ta.setSelectionRange(caret, caret);
      } catch (err) {
        /* ignore */
      }
      invalidateAutosize();
      autosize();
      if (findRef.current.open) refreshMatches();
      // R47: the peer moved the text, so this chapter's annotations move with
      // it exactly as they would after local typing. `commitSave` cannot do it
      // here — adoption deliberately leaves the buffer clean, so no save ever
      // runs for this change and without this line every underline in the
      // chapter would slide onto whatever now sits at those offsets.
      if ((d.oldMid || d.newMid) && typeof propsRef.current.onMarksShift === 'function') {
        try {
          propsRef.current.onMarksShift(d);
        } catch (err) {
          /* an annotation must never break an incoming edit */
        }
      }
      rebuildHighlights();
      revealPeerEdit(d.head);
      scheduleMeasure(false);
    }

    /**
     * Keeps the viewport on what matters after a peer's edit.
     *
     * The caret was shifted along with the text, so the line the writer was
     * reading is still the line they want: as long as that line left the screen
     * the viewport follows it and nothing else happens.
     *
     * When the caret is fine, the remaining question is whether to jump to the
     * actual change — which is what 「同步修改的位置」 asks for. Following the
     * change unconditionally is wrong in the other direction: it interrupts
     * whoever is writing in this pane. So the caret stays put while the
     * keyboard has been live in this pane recently (`PEER_FOLLOW_IDLE_MS`), and
     * otherwise the change is revealed.
     *
     * Membership is decided by recent typing rather than by `activeElement`:
     * clicking 「读一遍」 or the toolbar leaves focus elsewhere while the writer
     * is still sitting in this chapter, and none of those clicks mean "hand
     * the caret to the phone".
     */
    function revealPeerEdit(changedAt) {
      const v = resolveScroller(false);
      const sc = v && v.el;
      if (!sc) return;
      const target = caretScrollTop('nearest', v);
      if (target != null) {
        setScrollTop(target, v);
        return;
      }
      if (nowMs() - typedAtRef.current < PEER_FOLLOW_IDLE_MS) return;
      const viewH = sc.clientHeight || 0;
      const m = measureCaret(changedAt, v);
      if (!m) return;
      const scroll = sc.scrollTop || 0;
      if (m.top >= scroll - 8 && m.top + m.height <= scroll + viewH + 8) return;
      setScrollTop(m.top - Math.max(24, viewH * 0.25), v);
      // The line the caret sits on is now off-screen on purpose; a centred
      // typewriter pass would immediately drag it back and undo this.
      pendingCenterRef.current = false;
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

    /**
     * R47: the writer's own annotations.
     *
     * Kept separate from `setHighlights()` because that one is transient — the
     * advice panel uses it to point at a sentence and clears it as soon as the
     * writer moves on. Marks outlive all of that.
     */
    function setMarks(list) {
      marksRef.current = Array.isArray(list) ? list.slice() : [];
      rebuildHighlights();
    }

    /**
     * Which mark sits under `offset`, if any — newest (longest) wins.
     *
     * R52: `opts.edge` also accepts a caret that landed exactly on a mark's end.
     * Clicking the right half of the last underlined character puts the caret
     * *after* it, so a strict `offset < end` test made the card feel like it
     * only opened on a lucky pixel — reported as "双击才可以".
     */
    function markAt(offset, opts) {
      const want = opts || {};
      const own = marksRef.current || [];
      const at = numOf(offset, -1);
      if (at < 0) return null;
      let best = null;
      let edge = null;
      for (let i = 0; i < own.length; i += 1) {
        const r = own[i];
        if (!r) continue;
        const start = Number(r.start) || 0;
        const end = Number(r.end) || 0;
        if (want.kind && r.kind !== want.kind) continue;
        const inside = at >= start && at < end;
        if (!inside) {
          if (want.edge && at === end && end > start) {
            // Only a fallback: a mark that really contains the caret wins.
            if (!edge) edge = r;
          }
          continue;
        }
        if (!best || (end - start) <= (Number(best.end) - Number(best.start))) {
          best = r;
        }
      }
      return best || edge;
    }

    /** Two rows mark the same words (the same chapter: marksRef is per chapter). */
    function sameSpan(a, b) {
      if (!a || !b) return false;
      return Math.round(Number(a.start) || 0) === Math.round(Number(b.start) || 0)
        && Math.round(Number(a.end) || 0) === Math.round(Number(b.end) || 0);
    }

    /**
     * R53: put a read-only card next to the point that was clicked.
     *
     * It used to hang under the caret's line, which on a wide paper meant the
     * card could open a screen away from the line the writer was pointing at.
     * Now the card opens at the click: to the right of it when there is room,
     * flipped to the left when there is not, always inside the paper.
     */
    function openMarkView(mark, ev) {
      const stack = stackRef.current;
      if (!stack || !mark) return;
      // R53f：下划线 / 删除线的卡片只剩一个「删除」按钮，实测约 84×32，比批注卡小
      // 一大截。还按 200×150 去避让的话，卡片会在离点击处很远的地方落地，看着像
      // 点错了地方。两种尺寸分开算。
      const compact = String(mark.kind) !== 'comment';
      const cardW = compact ? 92 : 200;
      const cardH = compact ? 34 : 150;
      const box = stack.getBoundingClientRect();
      const stackW = box.width || 0;
      const vh = window.innerHeight || 768;
      let cx = Number(ev && ev.clientX);
      let cy = Number(ev && ev.clientY);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
        // Keyboard / programmatic open: fall back to the mark's own first line.
        const hl = hlRef.current;
        const node = hl && hl.querySelector('mark[data-id="' + String(mark.id) + '"]');
        const rects = node ? node.getClientRects() : [];
        const r0 = rects && rects.length ? rects[0] : null;
        cx = r0 ? r0.left + 2 : box.left + box.width / 2;
        cy = r0 ? r0.top + r0.height / 2 : box.top + 80;
      }
      // Paper-relative: the card lives inside `.nw-stack`, so it scrolls with
      // the words instead of hovering over the chrome.
      const localX = cx - box.left;
      let left = localX + 16;
      if (left + cardW > stackW - 8) left = localX - cardW - 16;
      left = clampNum(left, 8, Math.max(8, stackW - cardW - 8));
      // Prefer level with the click; when the card would run off the bottom of
      // the window, open it above the click instead of under it.
      let top = cy - 14;
      if (top + cardH > vh - 8) top = cy - cardH - 10;
      top = clampNum(top - box.top, 8, Math.max(8, (stack.scrollHeight || box.height) - 8));
      setMarkView({ mark: mark, left: Math.round(left), top: Math.round(top) });
      // Light the line the card belongs to, so the paper answers the click.
      const hl = hlRef.current;
      const nodes = hl ? hl.querySelectorAll('mark[data-id]') : [];
      for (let i = 0; i < nodes.length; i += 1) {
        const on = String(nodes[i].getAttribute('data-id')) === String(mark.id);
        if (on) nodes[i].setAttribute('data-active', '1');
        else nodes[i].removeAttribute('data-active');
      }
      const signs = gutterRef.current ? gutterRef.current.querySelectorAll('.nw-mark-side') : [];
      for (let i = 0; i < signs.length; i += 1) {
        const on = String(signs[i].getAttribute('data-id')) === String(mark.id);
        if (on) signs[i].setAttribute('data-active', '1');
        else signs[i].removeAttribute('data-active');
      }
    }

    function closeMarkView() {
      setMarkView((cur) => (cur ? null : cur));
      const hl = hlRef.current;
      const nodes = hl ? hl.querySelectorAll('mark[data-active]') : [];
      for (let i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute('data-active');
      const signs = gutterRef.current ? gutterRef.current.querySelectorAll('.nw-mark-side[data-active]') : [];
      for (let i = 0; i < signs.length; i += 1) signs[i].removeAttribute('data-active');
    }

    /**
     * R53c: the marking menu, opened by right-clicking a selection.
     *
     * The range is frozen at the moment the menu opens. The menu never appears
     * by itself — selecting words used to pop a three-button bar right over the
     * words being selected, which is what the writer asked to get rid of. Now
     * it only shows up when the writer asks for it (right-click), and it opens
     * at the pointer, next to the words instead of at the page corner.
     */
    function openMarkMenu(ev) {
      const ta = taRef.current;
      if (!ta) return;
      const a = Number(ta.selectionStart) || 0;
      const b = Number(ta.selectionEnd) || 0;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const text = ta.value.slice(start, end);
      const hasRange = end > start && !!String(text).trim() && end - start <= 4000;
      // 右键点在哪，菜单就长在哪。菜单是 .nw-surface 的直接子节点（固定在纸面
      // 之上，不跟着纸滚），所以坐标按 surface 换算；先右后左、先下后上夹在
      // 纸面之内。
      const surf = surfaceRef.current;
      const surfRect = surf ? surf.getBoundingClientRect() : null;
      const menuW = 152;
      const menuH = 132;
      let x = surfRect && ev ? Number(ev.clientX) - surfRect.left + 2 : 14;
      let y = surfRect && ev ? Number(ev.clientY) - surfRect.top + 2 : 46;
      if (surfRect) {
        if (x + menuW > surfRect.width - 8) x = Math.max(8, x - menuW - 4);
        if (y + menuH > surfRect.height - 8) y = Math.max(8, y - menuH - 4);
        x = Math.max(8, Math.min(x, Math.max(8, surfRect.width - menuW - 8)));
      }
      setMarkView(null);
      setMarkMenu({
        start: start,
        end: end,
        quote: String(text || '').slice(0, 240),
        hasRange: hasRange,
        x: Math.round(x),
        y: Math.round(y),
      });
    }

    function closeMarkMenu() {
      setMarkMenu((cur) => (cur ? null : cur));
    }

    /**
     * R53: create (or retype) a mark over the range the menu was opened on.
     *
     * Duplicates are killed at the source: the same words never become two
     * marks. Marking a span that is already marked just changes its type, and
     * marking it with the type it already has only puts the card back on it.
     * The database does the same merge, so a refresh cannot resurrect a twin.
     */
    function createMarkOfSelection(kind) {
      const menu = markMenuRef.current;
      const ta = taRef.current;
      if (!menu || !ta) return;
      if (!menu.hasRange) return;
      const start = clampNum(menu.start, 0, ta.value.length);
      const end = clampNum(menu.end, start, ta.value.length);
      if (end <= start) return;
      const text = ta.value.slice(start, end);
      const rows = marksRef.current || [];
      const existing = rows.find((r) => r && sameSpan(r, { start: start, end: end }));
      closeMarkMenu();
      if (existing) {
        const existingNote = String(existing.note || '').trim();
        // R53e：写着字的线就是批注，不能靠再点一次「下划线」把它降回一条线——
        // 那样要么丢掉作者写的话，要么存进去又被 db 判回 comment，界面上闪一下
        // 等于没反应。有字就只把卡片开出来，线本身不动。
        if (existingNote && String(kind) !== 'comment') {
          openMarkView(existing, null);
          return;
        }
        if (String(existing.kind) === String(kind)) {
          // Nothing to draw: the line is already on the paper. Just show it.
          openMarkView(existing, null);
          return;
        }
        marksRef.current = rows.map((r) => (r && sameSpan(r, { start: start, end: end })
          ? Object.assign({}, r, { kind: kind })
          : r));
        rebuildHighlights();
        if (typeof p.onMarkCreate === 'function') {
          const retyped = p.onMarkCreate(Object.assign({}, existing, { kind: kind }));
          if (retyped && typeof retyped.catch === 'function') retyped.catch(() => {});
        }
        const row = (marksRef.current || []).find((r) => r && sameSpan(r, { start: start, end: end }));
        if (row) openMarkView(row, null);
        return;
      }
      const id = 'mk-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
      const draft = {
        id: id,
        // Without this the row is thrown away by db.cleanMark (which requires a
        // chapter) — every mark drawn in the writing surface used to vanish.
        chapterId: chapterIdRef.current || (chapter && chapter.id) || '',
        kind: kind,
        start: start,
        end: end,
        quote: String(text || '').slice(0, 240),
        note: '',
      };
      // Paint it at once: the app round-trips through IndexedDB before the list
      // comes back, and a line that appears a beat late reads as "it didn't work".
      marksRef.current = rows.concat([draft]);
      rebuildHighlights();
      if (typeof p.onMarkCreate === 'function') {
        const created = p.onMarkCreate(draft);
        if (created && typeof created.catch === 'function') created.catch(() => {});
      }
      if (kind === 'comment') openMarkView(draft, null);
    }

    /** Delete a mark from the card, painting the change immediately. */
    function removeMarkOf(id) {
      if (id == null) return;
      const rows = marksRef.current || [];
      const target = rows.find((r) => r && String(r.id) === String(id));
      // R53: one delete removes every row that marks these words. Before this,
      // a range marked twice needed two deletes — the second row was invisible
      // (it drew on top of the first) but kept coming back.
      marksRef.current = rows.filter((r) => {
        if (!r) return false;
        if (String(r.id) === String(id)) return false;
        if (target && sameSpan(r, target)) return false;
        return true;
      });
      rebuildHighlights();
      closeMarkView();
      if (typeof p.onMarkRemove === 'function') {
        const done = p.onMarkRemove(id);
        if (done && typeof done.catch === 'function') done.catch(() => {});
      }
    }

    /**
     * R53: paint the note signs in the page margin.
     *
     * The old badge was a 12×9 box drawn at the end of the marked words, with a
     * negative `top` — it sat on the line above whenever the leading was tight,
     * which is exactly the "遮住字" the writer kept reporting. A sign in the
     * margin cannot overlap a glyph, and it is a real button instead of a
     * zero-width anchor that had to be hit-tested through the mirror.
     */
    function paintGutter() {
      const box = gutterRef.current;
      if (!box) return;
      // 重画前把上一轮的悬停点亮擦掉：签会被重建，正文上的 data-hover 却会留在
      // 旧节点上——不扫一遍的话，字改完之后会有一句一直亮着，像被选中了。
      const hl0 = hlRef.current;
      if (hl0) {
        const stale0 = hl0.querySelectorAll('[data-hover]');
        for (let i = 0; i < stale0.length; i += 1) stale0[i].removeAttribute('data-hover');
      }
      // R53e：签只属于有字的批注——空批注不再在页边留一枚什么都不指的签。
      const rows = (marksRef.current || []).filter(
        (r) => r && String(r.note || '').trim(),
      );
      // The common case is "no notes in this chapter": leave the (empty) layer
      // alone instead of rewriting it on every measured frame while typing.
      if (!rows.length) {
        if (box.firstChild) clearNode(box);
        return;
      }
      clearNode(box);
      const hl = hlRef.current;
      const stack = stackRef.current;
      if (!hl || !stack) return;
      const stackRect = stack.getBoundingClientRect();
      const stackW = stack.clientWidth || stackRect.width || 0;
      if (stackW < 40) return;
      const want = {};
      for (let i = 0; i < rows.length; i += 1) want[String(rows[i].id)] = rows[i];
      // R53b：签上写序号（本章之内按 start 排），否则同一行两条批注错开一格之
      // 后就是两枚一模一样的点，谁也认不出哪枚对哪句。悬停再点亮它那句。
      const seq = {};
      const ordered = rows.slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
      for (let i = 0; i < ordered.length; i += 1) seq[String(ordered[i].id)] = i + 1;
      const nodes = hl.querySelectorAll('mark.nw-hl-mark[data-id]');
      const placed = [];
      const seen = {};
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        const id = String(el.getAttribute('data-id') || '');
        if (!id || !want[id] || seen[id]) continue;
        const rects = el.getClientRects ? el.getClientRects() : [];
        if (!rects.length) continue;
        seen[id] = 1;
        const r0 = rects[0];
        placed.push({
          id: id,
          y: r0.top - stackRect.top + Math.min(r0.height, 26) / 2,
        });
      }
      if (!placed.length) return;
      placed.sort((a, b) => a.y - b.y);
      // Two signs on the same line would stack; push the later one down a row of
      // its own rather than letting them overlap into one indistinguishable blob.
      // R53c：错开之后不再画引线（用户说那条细线看不出来），改由「悬停/点开
      // 时句子明显变色」来指认——签上的序号说第几条，句子亮起来说哪一行。
      let last = -Infinity;
      const left = Math.round(Math.max(8, stackW - 22));
      const SIDE_H = 16;
      for (let i = 0; i < placed.length; i += 1) {
        const row = placed[i];
        let y = row.y - SIDE_H / 2;
        if (y - last < SIDE_H + 2) y = last + SIDE_H + 2;
        last = y;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nw-mark-side';
        btn.setAttribute('data-id', row.id);
        btn.setAttribute('aria-label', NW.t('第') + (seq[row.id] || '') + NW.t('条批注'));
        btn.title = '#' + (seq[row.id] || '') + ' ' + String(want[row.id].note || NW.t('批注')).slice(0, 80);
        btn.textContent = String(seq[row.id] || '');
        btn.style.left = left + 'px';
        btn.style.top = Math.round(y) + 'px';
        // 悬停点亮它指的那句：同一行两条批注时，这是唯一的「谁是谁」。
        btn.addEventListener('mouseenter', () => {
          const own = hl.querySelectorAll('mark[data-id="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].setAttribute('data-hover', '1');
        });
        btn.addEventListener('mouseleave', () => {
          const own = hl.querySelectorAll('mark[data-id="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].removeAttribute('data-hover');
        });
        box.appendChild(btn);
      }
    }

    /**
     * R51/R52: a click inside the textarea lands on a character, and that
     * character may be inside a mark. There is no DOM element per mark here —
     * the textarea is one big node — so the mark is found by hit-testing the
     * painted mirror, whose rects are the ground truth for wrapped lines.
     */
    function markAtPoint(ev) {
      const hl = hlRef.current;
      if (!hl || !ev) return null;
      const x = Number(ev.clientX);
      const y = Number(ev.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const nodes = hl.querySelectorAll('mark[data-id]');
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const rects = node.getClientRects ? node.getClientRects() : [];
        for (let r = 0; r < rects.length; r += 1) {
          const box = rects[r];
          // One pixel of slack: sub-pixel layout means the exact edge is not
          // reproducible, and a click on the last pixel of the line is still a
          // click on that line.
          if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) {
            const id = node.getAttribute('data-id');
            const rows = marksRef.current || [];
            for (let k = 0; k < rows.length; k += 1) {
              if (rows[k] && String(rows[k].id) === String(id)) return rows[k];
            }
          }
        }
      }
      return null;
    }

    function handleMarkClick(ev) {
      const ta = taRef.current;
      if (!ta) return;
      // R52: a click that ended a drag is the writer selecting words, not
      // asking about a line — the selection is about to become a new mark.
      // Anything else (including the second click of a double-click, which
      // leaves a word selected) is a real click on a line.
      const down = pointerDownRef.current;
      const moved = down && ev
        ? Math.abs(Number(ev.clientX) - down.x) + Math.abs(Number(ev.clientY) - down.y)
        : 0;
      if (moved > 6) {
        closeMarkView();
        return;
      }
      const at = ta.selectionStart;
      // Point first (exact, independent of the caret), offset as a fallback for
      // keyboard-driven clicks and for the tail of the last character.
      const hit = markAtPoint(ev)
        || (typeof at === 'number' && ta.selectionEnd === at ? (markAt(at, { edge: true }) || markAt(at - 1, { edge: true })) : null);
      if (!hit) {
        closeMarkView();
        return;
      }
      openMarkView(hit, ev);
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
      typedAtRef.current = nowMs();
      // R68: typing ends the sideways-arrow easing — a keystroke is writing,
      // and writing still gets the full centred typewriter.
      caretNavAtRef.current = -1e9;
      // R26: same as afterEdit — the status bar must say 未保存 from the first
      // keystroke, not 1.2s later when the debounce finally fires.
      const notify = propsRef.current.onDirty;
      if (typeof notify === 'function') {
        try {
          notify(true);
        } catch (err) {
          /* ignore */
        }
      }
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
        // R51: the card is the topmost thing on the paper, so Escape closes it
        // before it reaches the find bar or the immersive exit.
        if (markViewRef.current) {
          ev.preventDefault();
          closeMarkView();
          return;
        }
        if (findRef.current.open) {
          ev.preventDefault();
          closeFind();
        }
        return;
      }

      // R68: the horizontal arrows are handled separately, below, and must NOT
      // land in this set. Parking the typewriter here would also trip
      // isManuallyScrolling(), which returns before the reveal branch, so a
      // held arrow key would walk the caret off screen with the view frozen.
      // Vertical and paging keys park because the handler moves the viewport
      // itself; the horizontal keys only move the caret, so they ask for the
      // gentler 'nearest' scroll instead (see caretNavAtRef).
      const nav =
        ev.key === 'PageUp' ||
        ev.key === 'PageDown' ||
        ev.key === 'Home' ||
        ev.key === 'End' ||
        ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown';
      const caretNav = ev.key === 'ArrowLeft' || ev.key === 'ArrowRight';
      if (caretNav) {
        // One press, one move: the caret keeps its own step and the page keeps
        // still. At a line crossing the caret legitimately jumps from the end
        // of one line to the start of the next — that alone already reads as
        // "it passed the punctuation and the character" — and until now the
        // typewriter slid a whole line under it at the same moment, so a single
        // press looked like two.
        caretNavAtRef.current = nowMs();
      }
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

    // ---- chapter heading editing (R41 ①) ----------------------------------
    // The heading is a contenteditable div rather than an <input>: it must keep
    // the centred, wrapping, multi-line rendering the manuscript needs, and an
    // input would reset the height that chapterTitleH() subtracts from the
    // typewriter room. React keeps ownership of the text while it is NOT being
    // edited; only an accepted rename writes textContent directly, so a caret
    // is never thrown back to column 0 by a re-render mid-edit.

    function titleText() {
      const el = titleRef.current;
      if (!el) return '';
      // textContent, never innerText: innerText collapses on a hidden element
      // and would silently return '' if the pane is display:none.
      return String(el.textContent || '');
    }

    /** Collapse runs of whitespace: a heading is one logical line. */
    function normaliseTitle(raw) {
      return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 120);
    }

    function paintTitle(text) {
      const el = titleRef.current;
      if (!el) return;
      el.textContent = text;
      el.setAttribute('data-editing', '0');
    }

    function handleTitleFocus() {
      const el = titleRef.current;
      if (!el) return;
      titleSavedRef.current = normaliseTitle(chapterTitle);
      el.setAttribute('data-editing', '1');
    }

    function handleTitleInput() {
      const el = titleRef.current;
      if (!el) return;
      // Mark the block as editing so the paint pass knows a caret lives here.
      // Never rewrite the DOM while an IME is composing.
      if (composingRef.current) return;
      el.setAttribute('data-editing', '1');
    }

    async function commitTitle(discard) {
      const el = titleRef.current;
      if (!el || titleBusyRef.current) return;
      if (discard === true) {
        paintTitle(titleSavedRef.current || chapterTitle);
        return;
      }
      const next = normaliseTitle(titleText());
      const current = normaliseTitle(chapterTitle);
      // An empty heading is almost always a mis-click on the text: keep the
      // stored one instead of wiping the row (updateChapter would replace it
      // with a placeholder and lose the writer's name).
      if (!next || next === current) {
        paintTitle(current || titleSavedRef.current);
        return;
      }
      if (!onRenameTitle) {
        paintTitle(current);
        return;
      }
      titleBusyRef.current = true;
      el.setAttribute('data-editing', '0');
      let applied = null;
      try {
        applied = await onRenameTitle(chapterId, next);
      } catch (err) {
        applied = null;
      }
      titleBusyRef.current = false;
      // The app answers with the title the row actually holds (it trims and
      // substitutes a placeholder for an empty value). Falling back to the
      // previous string keeps a failed write visually neutral.
      const finalText = applied == null ? current : String(applied);
      titleSavedRef.current = finalText;
      paintTitle(finalText);
      remeasureAfterTitle();
    }

    /** Renaming changes the heading's height (one line -> two) and therefore
     *  the typewriter room; re-run the same pass the [chapterTitle] effect does. */
    function remeasureAfterTitle() {
      if (!surfaceRef.current || !taRef.current) return;
      const view = resolveScroller(false);
      if (view) applyTypewriterRoom(view);
      autosize();
      scheduleMeasure(false);
    }

    function handleTitleKeyDown(ev) {
      if (!ev) return;
      // IME: while a candidate window is open, Enter/Escape pick and cancel the
      // candidate — they are not "commit" and "revert" for the heading.
      if (ev.isComposing || composingRef.current) return;
      // Escape must be swallowed here: the app listens for it in the capture
      // phase to leave immersive mode, and defaultPrevented is its only test.
      const key = ev.key;
      if (key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        const el = titleRef.current;
        if (el && typeof el.blur === 'function') el.blur();
        return;
      }
      if (key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        const el = titleRef.current;
        commitTitle(true).then(() => {
          if (el && typeof el.blur === 'function') el.blur();
        });
        return;
      }
      // Every other key stays local: the global map owns Ctrl+S, Ctrl+F, Tab.
      ev.stopPropagation();
    }

    function handleTitleBlur() {
      commitTitle(false);
    }

    function handleTitlePaste(ev) {
      const clip = ev && ev.clipboardData;
      if (!clip || typeof clip.getData !== 'function') return;
      ev.preventDefault();
      const raw = clip.getData('text/plain') || clip.getData('text') || '';
      const text = normaliseTitle(raw);
      if (!text) return;
      // insertText keeps the browser's own undo stack alive, unlike writing
      // textContent, and it handles an existing selection correctly.
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (err) {
        ok = false;
      }
      if (!ok) {
        const el = titleRef.current;
        if (el) el.textContent = normaliseTitle(titleText() + text);
      }
      handleTitleInput();
    }

    function handleTitleDrop(ev) {
      // Dropping prose into the heading would bring invisible formatting along;
      // the heading only ever accepts plain text, like the paste handler above.
      ev.preventDefault();
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
      // IME text commits the same way a keystroke does: the writer is here.
      typedAtRef.current = nowMs();
      scheduleSave();
      if (findRef.current.open) refreshMatches();
      scheduleMeasure(true);
    }

    function onFindKeyDown(ev, role) {
      // Enter commits an IME candidate. Acting on that Enter moved the caret off
      // the hit, and in the replace box it wrote a half-composed word into the
      // manuscript — the same guard handleKeyDown has had since it was written.
      if (ev.isComposing || ev.keyCode === 229) return;
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
      // R41 ①: a half-typed heading belongs to the chapter it was typed in.
      // Reset the restore point and repaint the incoming title explicitly,
      // because React may keep the same DOM node across the switch.
      titleSavedRef.current = chapter ? String(chapter.title || '').trim() : '';
      titleBusyRef.current = false;
      paintTitle(titleSavedRef.current);
      cancelSave();

      const ta = taRef.current;
      const text = chapter && typeof chapter.content === 'string' ? chapter.content : '';
      valueRef.current = text;
      lastSavedRef.current = nextId == null ? null : text;
      dirtyRef.current = false;
      highlightsRef.current = [];
      manualAtRef.current = -1e9;
      // Switching chapters is not typing here: the first peer edit in the new
      // chapter should still be able to show itself.
      typedAtRef.current = -1e9;
      // R46: the cached caret line belonged to the old chapter's text.
      focusTopRef.current = -1;
      // R51: so did the card's mark and its offsets.
      setMarkView(null);
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

    // R46: turning the fade on/off (or changing how many lines stay clear) must
    // publish the attribute and re-place the band; the next measure pass alone
    // would take a keystroke. R54: the veils no longer depend on immersive mode,
    // but they DO depend on the page width (their inset is derived from it) and
    // on `--nw-gutter-x`, which applyDockLane() rewrites on layout changes —
    // so the band is re-placed whenever the column geometry can have moved.
    React.useEffect(() => {
      const view = resolveScroller(false);
      paintFocus(view, surfaceOrigin(view));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusOn, focusLines, pageWidth, effPageWidth]);

    // Adopt content the app pushed for the SAME chapter (version restore, AI
    // rewrite, LAN sync). Skipped when it merely echoes what we just saved,
    // which is what keeps the textarea effectively uncontrolled — no caret
    // jumping on save.
    //
    // R45: `adoptExternalText` keeps the caret where it was and does not dirty
    // the buffer. The previous one-liner reset the selection to the end of the
    // text, so every background rewrite — most visibly a phone edit arriving
    // over LAN — yanked the writer to the last line of the chapter.
    const incomingContent =
      chapter && typeof chapter.content === 'string' ? chapter.content : null;
    React.useEffect(() => {
      if (incomingContent === null || chapterIdRef.current == null) return;
      const ta = taRef.current;
      if (!ta) return;
      if (incomingContent === ta.value) return;
      if (incomingContent === lastSavedRef.current) return;
      adoptExternalText(incomingContent);
    }, [incomingContent]);

    // R47: annotations for the open chapter. The app owns the whole book's list
    // (the reading view shows all of it); this instance only draws its own
    // chapter, because a mark's offsets mean nothing in another chapter's text.
    const marksIn = p.marks;
    const marksChapterId = chapter && chapter.id != null ? String(chapter.id) : '';
    React.useEffect(() => {
      if (!marksChapterId) return;
      const list = (Array.isArray(marksIn) ? marksIn : []).filter(
        (row) => row && String(row.chapterId) === marksChapterId,
      );
      setMarks(list);
      // R51: if the card was describing a mark that has just been deleted (here
      // or on the phone), it has nothing left to describe.
      const open = markViewRef.current;
      if (open && open.mark && !list.some((row) => String(row.id) === String(open.mark.id))) {
        setMarkView(null);
      }
    }, [marksIn, marksChapterId]);

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
        // R46: the fade is positioned in viewport pixels, so it has to follow
        // the scroller even when the caret did not move. This uses the cached
        // line top only — no rect, no mirror, no reflow.
        repaintFocusSoon();
        const sc = scrollerRef.current;
        const at = sc ? sc.scrollTop || 0 : 0;
        if (Math.abs(at - expectedScrollTopRef.current) <= 2) return;
        // R53: the corner menu is anchored to the capsule, not to a line, so a
        // scroll can leave it alone — but the card points at words, so it goes.
        if (markViewRef.current) closeMarkView();
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
      /**
       * R30: Ctrl/Cmd+F used to be caught only by the textarea's own onKeyDown,
       * so the shortcut died the moment focus left the manuscript — clicking the
       * shelf, the note card, or simply loading a chapter and typing nowhere.
       * The user reported it as "查找替换快捷键没反应", which was exactly that:
       * the handler existed, but only on one element.
       *
       * It is now a window capture listener, so it works whenever the writing
       * surface is mounted. Three guards keep it from stealing the key:
       *   - a dialog on top owns the keyboard (its own inputs must keep working);
       *   - the find bar's own inputs already handle it and must not re-enter;
       *   - the textarea path still handles it first (capture fires earlier, so
       *     opening twice is harmless — openFind() is idempotent).
       */
      const onFindShortcut = (ev) => {
        if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) return;
        if (String(ev.key || '').toLowerCase() !== 'f') return;
        const target = ev.target;
        if (target && typeof target.closest === 'function') {
          if (target.closest('.nw-modal-mask')) return; // a dialog owns the key
          if (target.closest('.nw-findbar')) return; // already in the find bar
        }
        ev.preventDefault();
        ev.stopPropagation();
        openFind(true);
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
      // R30: Ctrl/Cmd+F works from anywhere on the surface, not just the textarea.
      window.addEventListener('keydown', onFindShortcut, true);

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
        window.removeEventListener('keydown', onFindShortcut, true);
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

    // R53c：标记菜单——从**右键**弹出（角上那颗铅笔已按用户要求撤掉），永远不会
    // 因为「选中了字」自己冒出来。三行，每行带一小段样本，选之前就能看见画出来
    // 是什么样。`onMouseDown` preventDefault 是为了保住冻结的选区——菜单被点时
    // textarea 若失焦，selectionStart/End 就没了。
    const markMenuBar = markMenu
      ? h(
          'div',
          {
            className: 'nw-mark-menu',
            role: 'menu',
            'aria-label': NW.t('标一下'),
            // R53c：跟着右键的位置走，不再是左上角那个固定点。
            style: { left: (markMenu.x || 0) + 'px', top: (markMenu.y || 0) + 'px' },
            onMouseDown: (ev) => {
              if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
            },
          },
          h(
            'div',
            { className: 'nw-mark-menu-quote' },
            markMenu.hasRange
              ? '「' + String(markMenu.quote || '').slice(0, 14) + '」'
              : NW.t('先选中一段字'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'nw-mark-menu-btn',
              role: 'menuitem',
              disabled: !markMenu.hasRange,
              onClick: () => createMarkOfSelection('underline'),
            },
            h('span', { className: 'nw-mark-menu-swatch', 'data-kind': 'underline' }),
            NW.t('下划线'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'nw-mark-menu-btn',
              role: 'menuitem',
              disabled: !markMenu.hasRange,
              onClick: () => createMarkOfSelection('strike'),
            },
            h('span', { className: 'nw-mark-menu-swatch', 'data-kind': 'strike' }),
            NW.t('删除线'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'nw-mark-menu-btn',
              role: 'menuitem',
              disabled: !markMenu.hasRange,
              onClick: () => createMarkOfSelection('comment'),
            },
            h('span', { className: 'nw-mark-menu-swatch', 'data-kind': 'comment' }),
            NW.t('批注'),
          ),
        )
      : null;

    // R51: the read-only mark card. Deliberately no <textarea> in it: the
    // writing surface is where the line is, so it is where you find out what the
    // line says; writing the note happens in 读一遍, where the whole page is
    // yours and there is room to think. 删除 is here because deleting is a
    // reading-time decision — you see the line is wrong and it is gone.
    //
    // R53g：这张卡上不再有引文，也没有「知道了」。引文是刚点的那句字，正文里就在
    // 眼前，抄一遍只是把同一句话说了两次；「知道了」是为了关掉一张本来不该挡路的
    // 卡而多出来的一个动作——点别处就收，卡片自己会走。批注还留着它那句话本身
    // （那是这条批注存在的理由），下划线和删除线则只剩一个「删除」。
    const markIsLine = markView && markView.mark
      && String(markView.mark.kind) !== 'comment';
    const markCard =
      markView && markView.mark
        ? h(
            'div',
            {
              className: 'nw-mark-view',
              'data-compact': markIsLine ? '1' : '0',
              role: 'dialog',
              'aria-label': NW.t('标注'),
              style: { left: markView.left + 'px', top: markView.top + 'px' },
              onMouseDown: (ev) => {
                // Do not let the card steal the caret from the textarea: that
                // would fire onSelect → scheduleMeasure and move the viewport.
                if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
              },
            },
            markIsLine
              ? null
              : h(
                'div',
                {
                  className: 'nw-mark-view-note',
                  'data-empty': String(markView.mark.note || '').trim() ? '0' : '1',
                },
                String(markView.mark.note || '').trim() || NW.t('在「读一遍」里写这句话'),
              ),
            h(
              'div',
              { className: 'nw-mark-view-acts' },
              h('button', {
                type: 'button',
                className: 'nw-mark-view-btn',
                'data-danger': '1',
                onClick: () => {
                  // R52: go through removeMarkOf so the line disappears in this
                  // frame instead of waiting for the list to come back from
                  // IndexedDB — otherwise 删除 looks like it did nothing.
                  removeMarkOf(markView.mark.id);
                },
              }, NW.t('删除')),
            ),
          )
        : null;

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
          // R41 ①: the heading is always mounted (a fresh chapter needs a place
          // to type its name) and is edited in place. Its text is written by the
          // ref callback / paintTitle instead of by React children: a re-render
          // mid-edit (save-state flips re-render the whole studio) would otherwise
          // reset the text to the stored title and yank the caret to column 0.
          h(
            'div',
            {
              className: 'nw-chaptertitle',
              ref: (el) => {
                titleRef.current = el;
                if (!el) return;
                if (el.getAttribute('data-editing') === '1') return;
                if (el.textContent !== chapterTitle) el.textContent = chapterTitle;
              },
              role: 'heading',
              'aria-level': 1,
              'aria-label': NW.t('章节标题'),
              contentEditable: onRenameTitle ? 'plaintext-only' : undefined,
              suppressContentEditableWarning: true,
              spellCheck: false,
              'data-empty': titlePlaceholder ? '1' : '0',
              'data-placeholder': NW.t('章节标题'),
              onKeyDown: onRenameTitle ? handleTitleKeyDown : undefined,
              onFocus: onRenameTitle ? handleTitleFocus : undefined,
              onBlur: onRenameTitle ? handleTitleBlur : undefined,
              onInput: onRenameTitle ? handleTitleInput : undefined,
              onPaste: onRenameTitle ? handleTitlePaste : undefined,
              onDrop: onRenameTitle ? handleTitleDrop : undefined,
            },
          ),
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
              onMouseDown: (ev) => {
                // Suppress re-centring until mouseup so a drag-selection is not
                // fought by the script while the pointer is still down.
                draggingRef.current = true;
                // R52: remember where the press started — a click and a drag
                // both end in `click`, and only one of them means "what is this
                // line?".
                pointerDownRef.current = ev
                  ? { x: Number(ev.clientX) || 0, y: Number(ev.clientY) || 0 }
                  : null;
              },
              onBlur: handleBlur,
              onFocus: () => scheduleMeasure(false),
              onClick: (ev) => {
                scheduleMeasure(true);
                handleMarkClick(ev);
              },
              onCompositionStart: handleCompositionStart,
              onCompositionEnd: handleCompositionEnd,
              onSelect: () => scheduleMeasure(true),
              // R53c：标注的唯一入口。选中一段字再按右键 → 在指针旁弹出小菜单；
              // 没选中就原样放行，浏览器自己的复制/粘贴菜单照旧。这样纸面上不
              // 再需要任何常驻按钮。
              // 右键直接点在一条已有的线上（且没有选中文字）时，按「看批注」处理：
              // 那一下的意思几乎总是「这条线写了什么」。
              onContextMenu: (ev) => {
                const ta = taRef.current;
                if (!ta) return;
                const a = Number(ta.selectionStart) || 0;
                const b = Number(ta.selectionEnd) || 0;
                const hasRange = Math.max(a, b) - Math.min(a, b) > 0;
                if (hasRange) {
                  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                  openMarkMenu(ev);
                  return;
                }
                const hit = markAtPoint(ev);
                if (hit) {
                  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
                  openMarkView(hit, ev);
                }
              },
            }),
            // R51: the read-only card. It sits inside `.nw-stack` so it scrolls
            // with the paper, and after the textarea so it is never buried under
            // the text it is describing.
            markCard,
            // R53: note signs live in the page margin, outside the words. Filled
            // imperatively by paintGutter() so a sign costs one absolutely
            // positioned button instead of an inline element in the mirror.
            h('div', {
              className: 'nw-mark-gutter',
              ref: gutterRef,
              onMouseDown: (ev) => {
                // A sign must not steal the caret from the textarea.
                if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
              },
              onClick: (ev) => {
                const node = ev && ev.target;
                if (!node || typeof node.closest !== 'function') return;
                const sign = node.closest('.nw-mark-side[data-id]');
                if (!sign) return;
                ev.preventDefault();
                ev.stopPropagation();
                const id = sign.getAttribute('data-id');
                const rows = marksRef.current || [];
                for (let i = 0; i < rows.length; i += 1) {
                  if (rows[i] && String(rows[i].id) === String(id)) {
                    openMarkView(rows[i], ev);
                    return;
                  }
                }
              },
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
      // R46: the fade that keeps the current line in front of the eye. They sit
      // outside .nw-scroll because a scrolling ancestor would drag them along;
      // paintFocus() keeps them in viewport coordinates instead.
      h('div', { className: 'nw-veil nw-veil-top', ref: veilTopRef, 'aria-hidden': 'true' }),
      h('div', { className: 'nw-veil nw-veil-bot', ref: veilBotRef, 'aria-hidden': 'true' }),
      findBar,
      // R53c：角落胶囊里只剩「回到首页」和「锁定」。原来那颗标记铅笔被用户点名
      // 去掉了——标注是低频动作，不值得常驻一格视觉重量。入口改成选中字之后按
      // 右键（见 textarea 的 onContextMenu），菜单开在指针旁边。
      h(
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
            // R33: 首页 itself now brings the shelf back, so the dedicated
            // 目录 toggle is gone — one button, one meaning, and the corner
            // stops needing a hairline to separate three things.
            onLock ? h('span', { className: 'nw-acts-div', 'aria-hidden': 'true' }) : null,
            // R53c：这里原来有一颗铅笔按钮（R53 的入口），用户点名去掉了——它常驻
            // 在纸面上方，为一件事关标注的低频动作占一格视觉重量。入口改到右键
            // 菜单（见 textarea 的 onContextMenu），没有可见按钮，也就没有遮挡。
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
          ),
      markMenuBar,
    );
  };
})();
