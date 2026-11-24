;(() => {
  'use strict';

  // ===========================================================================
  // 98c-signature.js — R119 「灯下的稿纸」signature pass.
  //
  // The last styling part (99-end.js is code), so at equal specificity it wins
  // over every earlier sheet without a single !important. Everything here is
  // decoration on a layout that already works: no markup is added, no class is
  // invented, no behaviour changes.
  //
  // Five rules, so this file can be audited later:
  //   1. One light source. The desk is a soft radial from just above the paper;
  //      everything raised throws a shadow in the same direction.
  //   2. Paper is a material. A manuscript sheet gets a hairline, a 1px lit top
  //      edge, a very low-frequency grain (the --nw-texture hook every palette
  //      left at none) and a quiet drop.
  //   3. The brand colour is an accent, never a surface: the rule under a
  //      section head, the active row's edge, the goal arc, the focus ring.
  //   4. Type does the motivating: serif for what is *read* (titles, the
  //      manuscript, book names), sans and tabular numerals for what is
  //      *operated* (buttons, counters, meta).
  //   5. Motion is felt, not watched: 120ms feedback, 180ms travel, never on a
  //      layout property, and 96-motion.js already switches all of it off under
  //      prefers-reduced-motion.
  //
  // Colour stays inside the token vocabulary of 05-css.js and the palette remap
  // in 98-shell-theme.js. The only literals are white/black alphas (a highlight
  // has no token peer) and the grain bitmap.
  // ===========================================================================

  // ---------------------------------------------------------------- tokens --
  NW.CSS_PARTS.push(`
.nw-root{
  /* --- ink ladder: three steps of "how much does this matter" ------------ */
  --nw-ink:var(--nw-fg);
  --nw-ink-quiet:color-mix(in srgb, var(--nw-fg) 76%, var(--nw-bg));
  --nw-ink-faint:color-mix(in srgb, var(--nw-fg) 48%, var(--nw-bg));

  /* --- brand ladder: one saturated colour at three strengths ------------- */
  --nw-accent:var(--nw-brand);
  --nw-accent-wash:color-mix(in srgb, var(--nw-brand) 9%, transparent);
  --nw-accent-wash-2:color-mix(in srgb, var(--nw-brand) 16%, transparent);
  --nw-accent-line:color-mix(in srgb, var(--nw-brand) 32%, transparent);

  /* --- hairlines: a paper edge is darker paper, not a grey line ---------- */
  --nw-hair:color-mix(in srgb, var(--nw-fg) 9%, transparent);
  --nw-hair-strong:color-mix(in srgb, var(--nw-fg) 17%, transparent);

  /* --- light: the lamp above the desk, and the lit edge of a sheet ------- */
  --nw-lamp:radial-gradient(130% 80% at 50% -14%,
    color-mix(in srgb, var(--nw-brand) 6%, transparent), transparent 62%);
  --nw-lit-edge:inset 0 1px 0 color-mix(in srgb, #fff 44%, transparent);

  /* --- depth: one direction, three heights ------------------------------- */
  --nw-rise-1:0 1px 1px color-mix(in srgb, var(--nw-fg) 5%, transparent),
    0 2px 6px color-mix(in srgb, var(--nw-fg) 5%, transparent);
  --nw-rise-2:0 2px 4px color-mix(in srgb, var(--nw-fg) 6%, transparent),
    0 10px 26px color-mix(in srgb, var(--nw-fg) 9%, transparent);
  --nw-rise-3:0 3px 8px color-mix(in srgb, var(--nw-fg) 8%, transparent),
    0 26px 60px color-mix(in srgb, var(--nw-fg) 15%, transparent);

  /* --- the goal ring has wanted this token since 55-welcome.js:934 -------- */
  --nw-success:var(--nw-ok);

  /* --- radii, derived so the newspaper theme stays square ----------------
     (newspaper rewrites --nw-r-card/-control/-modal to 2–3px in 98-shell-theme,
     and every radius below follows automatically.) */
  --nw-r-sm:calc(var(--nw-r-control) - 2px);
  --nw-r-md:var(--nw-r-card);
  --nw-r-lg:var(--nw-r-modal);

  /* --- timing ----------------------------------------------------------- */
  --nw-t-fast:120ms;
  --nw-t-base:180ms;
  --nw-t-slow:260ms;
  --nw-e-out:cubic-bezier(.22,.7,.24,1);
  --nw-e-spring:cubic-bezier(.3,1.3,.4,1);
}

/* The desk. Two very wide, very low-contrast washes — the lamp from above, a
   faint vignette where the desk meets the floor — so an empty panel still has
   a centre. Both are alpha-only, so all five palettes share the rule. */
.nw-root{
  background-image:
    var(--nw-lamp),
    radial-gradient(140% 92% at 50% 118%,
      color-mix(in srgb, var(--nw-fg) 5%, transparent), transparent 58%);
}

/* Night needs its light to come from the lamp, not from white. */
.nw-root[data-theme="night"]{
  --nw-lamp:radial-gradient(130% 82% at 50% -14%,
    color-mix(in srgb, var(--nw-brand) 11%, transparent), transparent 60%);
  --nw-lit-edge:inset 0 1px 0 color-mix(in srgb, #fff 7%, transparent);
  --nw-rise-1:0 1px 2px rgba(0,0,0,.42);
  --nw-rise-2:0 2px 6px rgba(0,0,0,.44), 0 12px 30px rgba(0,0,0,.42);
  --nw-rise-3:0 4px 10px rgba(0,0,0,.48), 0 30px 70px rgba(0,0,0,.56);
  --nw-hair:color-mix(in srgb, #fff 9%, transparent);
  --nw-hair-strong:color-mix(in srgb, #fff 16%, transparent);
}

/* ============================================================ scrollbars == */
/* R139: 阅读页的翻页 scroller 不是「可以滚动的面板」，它只是把整本书摊成
   一列列、靠 scrollLeft 换页——滚动条对它没有意义，露出一条就等于把「这是
   网页」写在了书页下面。这条全局规则以前把它一起盖住了（.nw-root 星号选择器
   与 .nw-read-flow 特异性相同，而本文件拼接在 62-read.js 之后，于是后写的
   那条 width:0;height:0 反而输了），所以在这里显式排除，而不是在 62-read.js
   里靠提高特异性去打架。 */
/* R204: 同理再排除批注小卡的正文。它是唯一一个「内容超出就在原地滚、且不肯
   露出一条滚动条」的地方——这条全局规则的特异性（.nw-root + 两个 :not）
   压得住 .nw-mark-view-note 自己的 scrollbar-width:none，而且 Chromium 121
   起只要标准属性被写死在别的规则里，::-webkit-scrollbar 那几条就整个不生效，
   于是灰色长条照样冒出来。 */
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note){
  scrollbar-width:thin;scrollbar-color:color-mix(in srgb, var(--nw-fg) 22%, transparent) transparent;
}
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note)::-webkit-scrollbar{width:10px;height:10px;}
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note)::-webkit-scrollbar-track{background:transparent;}
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note)::-webkit-scrollbar-thumb{
  background:color-mix(in srgb, var(--nw-fg) 15%, transparent);
  border:3px solid transparent;border-radius:var(--nw-r-pill);background-clip:content-box;
}
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note)::-webkit-scrollbar-thumb:hover{
  background:color-mix(in srgb, var(--nw-fg) 30%, transparent);background-clip:content-box;
}
.nw-root *:not(.nw-read-flow):not(.nw-read-copy):not(.nw-mark-view-note)::-webkit-scrollbar-corner{background:transparent;}

/* ================================================================= type === */
/* Numbers that sit in a row and change while you watch them are tabular, so a
   word count does not jitter as it counts up. */
.nw-root :where(.nw-status,.nw-status-mid,.nw-status-today,.nw-goal-text,
  .nw-welcome-novelmeta,.nw-welcome-submeta,.nw-shelf-row-meta,.nw-shelf-book-meta,
  .nw-shelf-novel-meta,.nw-adv-ver,.nw-suggest-count,.nw-read-count,.nw-find-count){
  font-variant-numeric:tabular-nums;
  font-feature-settings:"tnum" 1;
}

/* A section head in this product is a *kicker*: small, spaced, quiet, with a
   short brand rule in front of it. Applied to the heads that already exist. */
.nw-welcome-cardtitle{
  color:var(--nw-ink-faint);
  font-family:var(--nw-ui-font);
  font-size:var(--nw-fs-tiny);
  font-weight:600;letter-spacing:.14em;text-transform:none;
}
.nw-welcome-cardtitle::before{
  content:'';display:inline-block;vertical-align:middle;
  width:18px;height:2px;margin-right:10px;border-radius:1px;
  background:var(--nw-accent);
}
.nw-welcome-title{
  font-family:var(--nw-reading-font);
  font-size:clamp(26px,3cqw,33px);
  line-height:1.16;letter-spacing:-.012em;font-weight:600;
}
.nw-welcome-lead{color:var(--nw-ink-quiet);}
/* The hero rule reads as a gesture: ink on the left, gone by the right. */
.nw-welcome-head::after{
  background:linear-gradient(90deg,
    var(--nw-hair-strong), var(--nw-hair) 46%, transparent 92%);
}

/* ================================================================ home ==== */
.nw-welcome-card{
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--nw-fg) 1.5%, transparent), transparent 40%),
    var(--nw-surface-overlay);
  border-color:var(--nw-hair);
  box-shadow:var(--nw-rise-1);
  transition:box-shadow var(--nw-t-base) var(--nw-e-out),
    border-color var(--nw-t-base) var(--nw-e-out);
}
.nw-welcome-inner > .nw-welcome-cols > .nw-welcome-col > .nw-welcome-card:hover{
  border-color:var(--nw-hair-strong);box-shadow:var(--nw-rise-2);
}

/* A novel row is the thing the writer actually clicks, so it gets the most
   material: a spine-ish mark on the left, a wash on hover, an accent edge when
   it is the one being written. */
.nw-welcome-novel{
  border-radius:var(--nw-r-md);
  border:1px solid transparent;
  transition:background var(--nw-t-fast) var(--nw-e-out),
    border-color var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out),
    transform var(--nw-t-fast) var(--nw-e-out);
}
.nw-welcome-novel:hover{
  background:var(--nw-surface-2);border-color:var(--nw-hair);
  box-shadow:var(--nw-rise-1);
}
.nw-welcome-novelname{
  font-family:var(--nw-reading-font);
  font-size:calc(var(--nw-fs-base) + 1px);font-weight:600;letter-spacing:-.004em;
}
.nw-welcome-novelcurrent{color:var(--nw-ink-quiet);}
/* Where you left off. Five red chapter names stacked down the column read as
   noise, so the verb keeps the accent and the chapter goes back to ink. */
.nw-welcome-novelcurrenttag{
  color:var(--nw-accent);font-weight:600;letter-spacing:.02em;
}
.nw-welcome-novelcurrentname{color:var(--nw-ink);font-weight:500;}
.nw-welcome-novelgo{
  color:var(--nw-ink-faint);
  transition:transform var(--nw-t-fast) var(--nw-e-out), color var(--nw-t-fast) var(--nw-e-out);
}
.nw-welcome-novel:hover .nw-welcome-novelgo{
  color:var(--nw-accent);transform:translateX(3px);
}
/* The little book mark in front of every novel row: a spine, not a bullet. */
.nw-welcome-novelmark{
  border-radius:var(--nw-r-sm);
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--nw-fg) 16%, transparent) 0 2px,
      transparent 2px),
    var(--nw-accent-wash);
  box-shadow:inset 0 0 0 1px var(--nw-hair);
}
.nw-welcome-novel:hover .nw-welcome-novelmark,
.nw-welcome-novel[data-active="1"] .nw-welcome-novelmark{
  background:
    linear-gradient(90deg, var(--nw-accent) 0 2px, transparent 2px),
    var(--nw-accent-wash-2);
}

/* Today's goal: the arc finally turns green when it is done, and the whole cell
   answers on hover, because this is the one number meant to pull you back. */
/* The stats card is a grey tray; its four cells are paper slips sitting in
   it, which gives the numbers a surface to sit on instead of floating. */
.nw-welcome-stat{
  background:var(--nw-bg);
  box-shadow:inset 0 0 0 1px var(--nw-hair);
}
.nw-welcome-stat dt{
  font-size:var(--nw-fs-micro);letter-spacing:.09em;text-transform:uppercase;
  color:var(--nw-ink-faint);
}
.nw-welcome-stat dd{font-size:17px;}
.nw-goal-track{stroke:color-mix(in srgb, var(--nw-fg) 12%, transparent);}
.nw-goal-fill{
  stroke:var(--nw-accent);
  stroke-linecap:round;
  transition:stroke-dashoffset 520ms var(--nw-e-out), stroke 240ms var(--nw-e-out);
  filter:drop-shadow(0 0 3px color-mix(in srgb, var(--nw-accent) 45%, transparent));
}
.nw-welcome-statgoal[data-done="1"] .nw-goal-fill{
  stroke:var(--nw-success);
  filter:drop-shadow(0 0 5px color-mix(in srgb, var(--nw-success) 55%, transparent));
}
.nw-welcome-statgoal{border-radius:var(--nw-r-md);transition:background var(--nw-t-fast) var(--nw-e-out);}
.nw-welcome-statgoal:hover{background:var(--nw-accent-wash);}
.nw-goal-text{font-weight:600;color:var(--nw-ink);}
.nw-welcome-stat dd{font-weight:600;color:var(--nw-ink);}
.nw-welcome-stat dt{color:var(--nw-ink-faint);font-size:var(--nw-fs-tiny);}

/* Inbox rows: the unread dot earns the accent; read rows stay quiet. */
.nw-welcome-subbtn{border-radius:var(--nw-r-md);border-color:transparent;}
.nw-welcome-subbtn:hover{background:var(--nw-surface-2);border-color:var(--nw-hair);}
.nw-welcome-subbtn.nw-welcome-sub-unread .nw-welcome-subtitle{font-weight:600;}
.nw-welcome-sub-unread::before{
  content:'';position:absolute;
  width:6px;height:6px;margin-left:-12px;margin-top:7px;
  border-radius:var(--nw-r-pill);background:var(--nw-accent);
}
.nw-welcome-subtitle{font-family:var(--nw-reading-font);}

/* A quick action that is disabled (投稿 with no novels yet) reads as a hint
   rather than a dead control. */
.nw-welcome-actions .nw-btn[data-kind="primary"]{
  box-shadow:0 1px 2px color-mix(in srgb, var(--nw-brand) 30%, transparent),
    0 8px 20px -8px color-mix(in srgb, var(--nw-brand) 55%, transparent);
}
`);

  // ---------------------------------------------------------------- shelf ---
  NW.CSS_PARTS.push(`
/* =============================================================== shelf ==== */
.nw-shelf{
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--nw-fg) 1.6%, transparent), transparent 240px),
    var(--nw-panel);
  border-right:1px solid var(--nw-hair);
}
.nw-shelf-toplabel{
  color:var(--nw-ink-faint);
  font-size:var(--nw-fs-tiny);font-weight:600;letter-spacing:.14em;
}
/* The search field is the only input in the rail: give it the sunken paper
   treatment so it reads as a place to type rather than a box. */
.nw-shelf-searchwrap .nw-input{
  background:var(--nw-sunken);
  border-color:transparent;
  box-shadow:inset 0 0 0 1px var(--nw-hair);
}
.nw-shelf-searchwrap .nw-input:hover{box-shadow:inset 0 0 0 1px var(--nw-hair-strong);}
.nw-shelf-searchwrap .nw-input:focus{
  background:var(--nw-bg);
  box-shadow:inset 0 0 0 1px var(--nw-accent-line), var(--nw-ring-soft);
}

/* Chapter rows. Hairline separators instead of borders, a wash on hover, and an
   accent edge + tint for the chapter being written. */
.nw-shelf-row{
  border-radius:var(--nw-r-sm);
  transition:background var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out);
}
.nw-shelf-row:hover{background:color-mix(in srgb, var(--nw-fg) 4.5%, transparent);}
.nw-shelf-row.is-active,
.nw-shelf-row[aria-selected="true"]{
  background:var(--nw-accent-wash);
  box-shadow:inset 3px 0 0 var(--nw-accent);
}
.nw-shelf-row.is-active .nw-shelf-row-title,
.nw-shelf-row[aria-selected="true"] .nw-shelf-row-title{
  color:var(--nw-ink);font-weight:600;
}
.nw-shelf-row-title{font-size:var(--nw-fs-second);}
.nw-shelf-row-meta{color:var(--nw-ink-faint);font-size:var(--nw-fs-tiny);}
.nw-shelf-row-meta[data-done="1"]{color:var(--nw-ok);}
/* Tree connectors: quieter than the row text, so the tree reads as a map. */
.nw-shelf-row[aria-level]::before{opacity:.55;}

/* Status dots: revising = warm, done = green, both tiny and lit. */
.nw-shelf-dot{border-radius:var(--nw-r-pill);}
.nw-shelf-dot[data-status="revising"]{
  background:var(--nw-warn);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-warn) 16%, transparent);
}
.nw-shelf-dot[data-status="done"]{
  background:var(--nw-ok);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-ok) 16%, transparent);
}

/* Book cover in the rail: two gradients pretending to be a spine and a page
   block, and a real shadow when the row is hovered. */
.nw-shelf-cover{
  border-radius:2px 3px 3px 2px;
  box-shadow:0 1px 2px color-mix(in srgb, var(--nw-fg) 18%, transparent);
  transition:transform var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out);
}
.nw-shelf-book-row:hover .nw-shelf-cover,
.nw-shelf-novel:hover .nw-shelf-cover{
  transform:translateY(-1px) rotate(-1deg);
  box-shadow:0 3px 8px color-mix(in srgb, var(--nw-fg) 22%, transparent);
}
.nw-shelf-book-row{border-radius:var(--nw-r-md);transition:background var(--nw-t-fast) var(--nw-e-out);}
.nw-shelf-book-row:hover{background:color-mix(in srgb, var(--nw-fg) 5%, transparent);}
.nw-shelf-book-row.is-active,
.nw-shelf-book-row[aria-pressed="true"]{
  background:var(--nw-accent-wash);
  box-shadow:inset 3px 0 0 var(--nw-accent);
}
.nw-shelf-book-title{font-family:var(--nw-reading-font);font-weight:600;}

.nw-shelf-novel{
  border:1px solid transparent;border-radius:var(--nw-r-md);
  transition:background var(--nw-t-fast) var(--nw-e-out),
    border-color var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out);
}
.nw-shelf-novel:hover{background:var(--nw-surface-2);border-color:var(--nw-hair);box-shadow:var(--nw-rise-1);}
.nw-shelf-novel.is-active{
  background:var(--nw-accent-wash);border-color:var(--nw-accent-line);
  box-shadow:inset 3px 0 0 var(--nw-accent);
}
.nw-shelf-novel-title{font-family:var(--nw-reading-font);font-weight:600;}

/* Rail footer tools + the library toggle: same material as the dock cards. */
.nw-shelf-foot{border-top:1px solid var(--nw-hair);}
.nw-shelf-library{border-radius:var(--nw-r-md);}
.nw-shelf-library:hover{background:var(--nw-surface-2);}
.nw-shelf-library.is-open .nw-shelf-library-label{color:var(--nw-ink);font-weight:600;}
.nw-shelf-library-count{color:var(--nw-ink-faint);font-variant-numeric:tabular-nums;}
.nw-shelf-indicator{background:var(--nw-accent);opacity:.5;}

/* The drag handle between rail and manuscript. */
.nw-splitter{transition:background var(--nw-t-fast) var(--nw-e-out);}
.nw-splitter:hover,.nw-splitter[data-drag="1"]{background:var(--nw-accent-line);}
`);

  // --------------------------------------------------------------- paper ----
  NW.CSS_PARTS.push(`
/* ============================================================== paper ===== */
/* The manuscript sheet. Every palette left --nw-texture at none; this is the
   hook the editor has always had for grain, so the paper finally has a
   material. One tile, 120px, 3% white-and-black noise: invisible at arm's
   length, but the page stops looking like a flat rectangle under the cursor. */
.nw-surface{--nw-grain:none;}
.nw-surface[data-theme="claude"],
.nw-surface[data-theme="eye"],
.nw-surface[data-theme="newspaper"],
.nw-surface[data-theme="magazine"]{
  --nw-texture:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)' opacity='.028'/%3E%3C/svg%3E");
}
.nw-surface[data-theme="night"]{
  --nw-texture:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23g)' opacity='.055'/%3E%3C/svg%3E");
}

/* Desk and sheet. The palette paints both white, so a page on it has no edge
   at all; a 3% ink wash on the pane is enough to make the paper a sheet again,
   and it costs nothing in the dark themes because the wash follows --nw-fg.
   The grain follows the paper, not the desk — noise under a sheet is just dirt. */
.nw-surface:not(.nw-read){
  background-image:none;
  background-color:color-mix(in srgb, var(--nw-bg) 95%, var(--nw-fg));
}
.nw-page{background-image:var(--nw-texture,none);}
/* On a dark palette the desk must sit *below* the sheet, not above it: mixing
   toward the ink would make the desk lighter than the page it holds. */
.nw-root[data-theme="night"] .nw-surface:not(.nw-read){
  background-color:color-mix(in srgb, var(--nw-bg) 78%, #000);
}

/* The sheet itself: a lit top edge, a hairline all round, and a drop that says
   "on a desk" without turning the manuscript into a card. Only once the page is
   narrower than the pane does it read as a sheet; below that it is the pane. */
@container nw (min-width: 780px){
  .nw-page{
    background-color:var(--nw-bg);
    box-shadow:
      var(--nw-lit-edge),
      0 1px 0 color-mix(in srgb, var(--nw-fg) 5%, transparent),
      0 18px 44px -26px color-mix(in srgb, var(--nw-fg) 40%, transparent);
  }
  .nw-surface[data-focus="1"] .nw-page,
  .nw-surface:focus-within .nw-page{
    box-shadow:
      var(--nw-lit-edge),
      0 1px 0 color-mix(in srgb, var(--nw-fg) 6%, transparent),
      0 24px 56px -28px color-mix(in srgb, var(--nw-fg) 46%, transparent);
  }
  /* Dark palette: light is the ink, so an ink-mixed drop becomes a glow around
     the sheet. Shadows go to black instead and the lit edge carries the rest. */
  .nw-root[data-theme="night"] .nw-page{
    box-shadow:
      var(--nw-lit-edge),
      0 1px 0 rgba(0,0,0,.55),
      0 20px 46px -26px rgba(0,0,0,.9);
  }
  .nw-root[data-theme="night"] .nw-surface[data-focus="1"] .nw-page,
  .nw-root[data-theme="night"] .nw-surface:focus-within .nw-page{
    box-shadow:
      var(--nw-lit-edge),
      0 1px 0 rgba(0,0,0,.6),
      0 26px 58px -28px rgba(0,0,0,.95);
  }
}

/* Chapter title: display serif, tighter, with the little rule under it tinted
   by the accent so the head of every chapter is a typographic event. */
.nw-chaptertitle{
  font-family:var(--nw-reading-font);
  letter-spacing:-.01em;
  color:var(--nw-ink);
}
.nw-chaptertitle::after{
  width:30px;height:1px;
  background:var(--nw-accent);
  opacity:.55;
}
.nw-chaptertitle:focus{outline:none;}

/* The caret is the only thing that moves while writing: accent it, and give it
   a hairline glow so the eye can find it on a page of grey text. */
.nw-cursor{
  background:var(--nw-accent);
  box-shadow:0 0 6px color-mix(in srgb, var(--nw-accent) 55%, transparent);
}
/* One selection colour everywhere: paper, textarea and chrome agree. */
.nw-ta::selection,
.nw-surface ::selection{
  background:color-mix(in srgb, var(--nw-brand) 20%, transparent);
}
.nw-veil{opacity:.9;}

/* Floating pieces on the paper: the selection button, the paragraph map, the
   find bar. All three are paper cards with a real edge. */
.nw-selbtn{
  border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-hair);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-rise-2), var(--nw-lit-edge);
  color:var(--nw-ink);
  transition:transform var(--nw-t-fast) var(--nw-e-spring),
    box-shadow var(--nw-t-fast) var(--nw-e-out);
}
.nw-selbtn:hover{
  transform:translateY(-1px);
  box-shadow:var(--nw-rise-3), var(--nw-lit-edge);
  color:var(--nw-accent);
}
.nw-findbar{
  border:1px solid var(--nw-hair);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-rise-2);
}

/* The acts capsule in the corner of the sheet (immersive hides it to 28%). */
.nw-surface-acts{
  border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-hair);
  background:color-mix(in srgb, var(--nw-surface-overlay) 88%, transparent);
  box-shadow:var(--nw-rise-2);
  backdrop-filter:blur(6px);
}
.nw-actbtn,.nw-homebtn{color:var(--nw-ink-quiet);}
.nw-actbtn:hover,.nw-homebtn:hover{color:var(--nw-accent);}
.nw-acts-div{background:var(--nw-hair);}
`);

  // ----------------------------------------------------------------- dock ---
  // Geometry is locked by verify-dock-hit (the surface lives in ::before and the
  // menu declares no box of its own), so this section spends only colour,
  // shadow and child transforms.
  NW.CSS_PARTS.push(`
/* =============================================================== dock ===== */
.nw-dock{--nw-dock-card:color-mix(in srgb, var(--nw-surface-overlay) 92%, transparent);}
.nw-dock-btn::before{
  border-color:color-mix(in srgb, var(--nw-hair) 100%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, #fff 26%, transparent), transparent 72%),
    var(--nw-dock-card);
  box-shadow:var(--nw-rise-1), var(--nw-lit-edge);
}
.nw-dock-btn:hover::before{
  border-color:var(--nw-hair-strong);
  box-shadow:var(--nw-rise-2), var(--nw-lit-edge);
}
.nw-dock-btn:hover{color:var(--nw-ink);}
.nw-dock-icon{
  border-radius:var(--nw-r-sm);
  /* No transform here: verify-dock-hit forbids any geometry-moving hover state
     on the dock, and a pressed edge that re-enters is worse than a still icon. */
  transition:background var(--nw-t-fast) var(--nw-e-out),
    color var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out);
}
.nw-dock-btn:hover .nw-dock-icon{
  background:var(--nw-accent-wash);
  color:var(--nw-accent);
  box-shadow:inset 0 0 0 1px var(--nw-accent-line);
}
.nw-dock-btn[data-blocked="1"]{opacity:.5;}
.nw-dock-fab::before{
  background:
    radial-gradient(120% 120% at 32% 18%, color-mix(in srgb, #fff 34%, transparent), transparent 62%),
    var(--nw-brand);
  box-shadow:0 2px 5px color-mix(in srgb, var(--nw-brand) 30%, transparent),
    0 12px 28px -10px color-mix(in srgb, var(--nw-brand) 62%, transparent),
    var(--nw-lit-edge);
}
.nw-dock-fab:hover::before{
  box-shadow:0 3px 8px color-mix(in srgb, var(--nw-brand) 34%, transparent),
    0 16px 34px -10px color-mix(in srgb, var(--nw-brand) 70%, transparent),
    var(--nw-lit-edge);
}
.nw-dock-fabicon{transition:transform var(--nw-t-base) var(--nw-e-spring);}
.nw-dock[data-theme="night"] .nw-dock-fab::before{
  background:radial-gradient(120% 120% at 32% 18%, color-mix(in srgb, #fff 18%, transparent), transparent 62%), var(--nw-brand);
}
`);

  // -------------------------------------------------------------- dialogs ---
  NW.CSS_PARTS.push(`
/* ============================================================= dialogs ==== */
.nw-modal-mask{
  background:
    radial-gradient(120% 90% at 50% 0%, transparent 30%, rgba(0,0,0,.10) 100%),
    rgba(0,0,0,.40);
  backdrop-filter:blur(5px) saturate(.94);
}
.nw-modal{
  border:1px solid var(--nw-hair);
  box-shadow:var(--nw-rise-3), var(--nw-lit-edge);
}
/* The headband becomes one short editorial tick sitting inside the corner,
   instead of a 2px colour bar stretching across the whole dialog. */
.nw-modal::before{
  left:22px;right:auto;width:34px;
  background:var(--nw-accent);
  opacity:.85;
}
.nw-modal-head h2{
  font-family:var(--nw-reading-font);
  letter-spacing:-.008em;
}
.nw-modal-head{border-bottom:1px solid var(--nw-hair);}
.nw-modal-foot{border-top:1px solid var(--nw-hair);}
.nw-modal-body > p,
.nw-modal-body .nw-rowhint{color:var(--nw-ink-quiet);}

/* Controls: one material for every field in the product. */
.nw-input,.nw-select,.nw-textarea{
  border-color:var(--nw-hair);
  background:var(--nw-surface-overlay);
  transition:border-color var(--nw-t-fast) var(--nw-e-out),
    box-shadow var(--nw-t-fast) var(--nw-e-out),
    background var(--nw-t-fast) var(--nw-e-out);
}
.nw-input:hover,.nw-select:hover,.nw-textarea:hover{border-color:var(--nw-hair-strong);}
.nw-input:focus,.nw-select:focus,.nw-textarea:focus{
  border-color:var(--nw-accent-line);
  box-shadow:var(--nw-ring-soft);
  outline:none;
}
.nw-input::placeholder,.nw-textarea::placeholder{color:var(--nw-ink-faint);}

/* Primary button: ink block with a lit top edge and an accent shadow that only
   shows up on hover. */
.nw-btn[data-kind="primary"]{box-shadow:var(--nw-lit-edge), 0 1px 2px color-mix(in srgb, var(--nw-brand) 26%, transparent);}
.nw-btn[data-kind="primary"]:hover:not(:disabled){
  box-shadow:var(--nw-lit-edge), 0 10px 24px -12px color-mix(in srgb, var(--nw-brand) 70%, transparent);
}
.nw-btn[data-kind="ghost"]{color:var(--nw-ink-quiet);}
.nw-btn[data-kind="ghost"]:hover:not(:disabled){color:var(--nw-ink);border-color:var(--nw-hair-strong);}
.nw-btn[data-kind="icon"]{color:var(--nw-ink-quiet);}
.nw-btn[data-kind="icon"]:hover:not(:disabled){color:var(--nw-accent);}
.nw-btn[data-kind="danger"]{color:var(--nw-danger);}

/* Switch: a track that tints with the accent and a thumb with a real shadow. */
.nw-switch > i{
  background:color-mix(in srgb, var(--nw-fg) 14%, transparent);
  box-shadow:inset 0 0 0 1px var(--nw-hair);
  transition:background var(--nw-t-base) var(--nw-e-out),
    box-shadow var(--nw-t-base) var(--nw-e-out);
}
.nw-switch > input:checked + i{
  background:color-mix(in srgb, var(--nw-brand) 90%, var(--nw-bg));
  box-shadow:inset 0 1px 2px color-mix(in srgb, #000 22%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--nw-fg) 10%, transparent);
}
.nw-switch > i::after{
  background:#fff;
  box-shadow:0 1px 2px color-mix(in srgb, var(--nw-fg) 26%, transparent),
    0 0 0 .5px color-mix(in srgb, var(--nw-fg) 10%, transparent);
}

/* Segmented control and chips share one selected look: accent tint + hairline. */
.nw-seg{border:1px solid var(--nw-hair);border-radius:var(--nw-r-pill);background:var(--nw-sunken);}
.nw-seg .nw-btn[data-active="1"]{
  background:var(--nw-bg);color:var(--nw-ink);
  box-shadow:var(--nw-rise-1);border-color:transparent;
}
.nw-chip[data-active="1"],
.nw-choice[data-active="1"],
.nw-advice-chip[data-on="1"]{
  background:var(--nw-accent-wash);
  border-color:var(--nw-accent-line);
  color:var(--nw-accent);
}
.nw-chip,.nw-choice,.nw-advice-chip{transition:background var(--nw-t-fast) var(--nw-e-out),
  border-color var(--nw-t-fast) var(--nw-e-out), color var(--nw-t-fast) var(--nw-e-out);}
.nw-advice-chip:hover:not([data-on="1"]):not(:disabled){background:var(--nw-surface-2);}

/* Settings: a serif section head with the magazine-style brand tick, a nav that
   marks the open pane with an accent edge rather than a filled block. */
.nw-settings-navbtn{
  border-radius:var(--nw-r-sm);
  color:var(--nw-ink-quiet);
  transition:background var(--nw-t-fast) var(--nw-e-out), color var(--nw-t-fast) var(--nw-e-out);
}
.nw-settings-navbtn:hover{background:var(--nw-surface-2);color:var(--nw-ink);}
.nw-settings-navbtn[data-active="1"]{
  background:var(--nw-accent-wash);color:var(--nw-ink);font-weight:600;
  box-shadow:inset 3px 0 0 var(--nw-accent);
}
.nw-settings-pane h3,
.nw-settings-section > h3{font-family:var(--nw-reading-font);letter-spacing:-.006em;color:var(--nw-ink);}
/* Two marks met here: 97-theme draws a 3px vertical tick before the heading and
   the magazine palette draws a 2px rule under it. Both is a shrug, so the tick
   retires in *every* palette and the rule gets a hairline tail that carries it
   across the section, like a magazine standfirst. */
.nw-settings-section > h3{position:relative;}
.nw-settings-section > h3::before{display:none;}
.nw-settings-section > h3::after,
.nw-root[data-theme="magazine"] .nw-settings-section > h3::after{
  content:'';
  position:absolute;left:0;right:0;bottom:-7px;
  width:auto;height:1px;border-radius:0;
  background:linear-gradient(90deg,
    var(--nw-accent) 0 30px,
    var(--nw-hair) 30px 100%);
}
.nw-settings-pane h4{color:var(--nw-ink-quiet);letter-spacing:.02em;}
.nw-row{border-bottom-color:var(--nw-hair);}
.nw-rowitem{border-radius:var(--nw-r-sm);}
.nw-rowitem:hover{background:var(--nw-surface-2);}
.nw-rowitem[data-active="1"]{background:var(--nw-accent-wash);box-shadow:inset 2px 0 0 var(--nw-accent);}
.nw-kbd-row kbd{
  border:1px solid var(--nw-hair);border-radius:var(--nw-r-sm);
  background:var(--nw-sunken);box-shadow:0 1px 0 var(--nw-hair-strong);
  color:var(--nw-ink-quiet);font-variant-numeric:tabular-nums;
}
.nw-fold > summary{border-radius:var(--nw-r-sm);}
.nw-fold > summary:hover{color:var(--nw-ink);}

/* Toasts: a paper slip with a coloured dot and a real shadow. */
.nw-toast{
  border:1px solid var(--nw-hair);
  box-shadow:var(--nw-rise-2);
  backdrop-filter:blur(8px);
}
.nw-toast[data-kind="ok"]::before{background:var(--nw-ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-ok) 18%, transparent);}
.nw-toast[data-kind="error"]::before{background:var(--nw-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-danger) 18%, transparent);}
.nw-toast[data-kind="info"]::before{background:var(--nw-brand);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-brand) 18%, transparent);}
.nw-toast-act{color:var(--nw-accent);}
`);

  // --------------------------------------------------------------- advice ---
  NW.CSS_PARTS.push(`
/* ============================================================== advice ==== */
/* aside.nw-suggest is the column; div.nw-suggest is a suggestion card from an
   older sheet. The card rule comes first in the cascade, so the panel inherits
   its padding and border — scope the panel explicitly. */
aside.nw-suggest{
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--nw-fg) 1.6%, transparent), transparent 200px),
    var(--nw-panel);
  border-left:1px solid var(--nw-hair);
  box-shadow:none;
}
aside.nw-suggest:hover{box-shadow:none;}
.nw-suggest-title{
  font-family:var(--nw-reading-font);
  font-size:calc(var(--nw-fs-base) + 1px);font-weight:600;letter-spacing:-.004em;
}
.nw-suggest-title::before{
  content:'';display:inline-block;vertical-align:middle;
  width:18px;height:2px;margin-right:10px;border-radius:1px;background:var(--nw-accent);
}
.nw-suggest-count{
  color:var(--nw-ink-faint);
  border:1px solid var(--nw-hair);border-radius:var(--nw-r-pill);
}
.nw-advice-chip{
  border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-hair);
  color:var(--nw-ink-quiet);
}

/* A suggestion card is the reading unit of this column: paper, a kind tag, the
   quoted passage in serif, the advice in the body colour. */
.nw-adv{
  border:1px solid var(--nw-hair);
  border-radius:var(--nw-r-md);
  background:var(--nw-surface-overlay);
  box-shadow:var(--nw-rise-1);
  transition:box-shadow var(--nw-t-base) var(--nw-e-out),
    border-color var(--nw-t-base) var(--nw-e-out),
    transform var(--nw-t-base) var(--nw-e-out);
}
.nw-adv:hover{
  border-color:var(--nw-hair-strong);
  box-shadow:var(--nw-rise-2);
  transform:translateY(-1px);
}
.nw-adv[data-state="accepted"]{border-color:color-mix(in srgb, var(--nw-ok) 34%, var(--nw-hair));}
.nw-adv[data-state="rejected"]{opacity:.62;box-shadow:none;}
/* The before/after pair reads as a marked-up proof: two tinted slips of equal
   height, each labelled, with the changed characters carrying the only strong
   colour. The clipped scroll box the old sheet used is gone — a 20-character
   quote must never need scrolling. */
.nw-adv-compare{border-radius:var(--nw-r-sm);align-items:stretch;gap:10px;}
.nw-adv-side{
  padding:8px 10px;border-radius:var(--nw-r-sm);
  border:1px solid var(--nw-hair);
  box-shadow:inset 2px 0 0 color-mix(in srgb, var(--nw-fg) 10%, transparent);
}
.nw-adv-side[data-kind="old"]{
  background:color-mix(in srgb, var(--nw-surface-2) 90%, var(--nw-danger) 10%);
  box-shadow:inset 2px 0 0 color-mix(in srgb, var(--nw-danger) 40%, transparent);
}
.nw-adv-side[data-kind="new"]{
  background:color-mix(in srgb, var(--nw-surface-2) 88%, var(--nw-ok) 12%);
  box-shadow:inset 2px 0 0 color-mix(in srgb, var(--nw-ok) 45%, transparent);
}
/* Equal specificity to the base [data-kind] .nw-adv-txt rules, but later in the
   cascade — that is the only way to drop the old dashed box and the paragraph-
   wide underline without reaching for !important. */
.nw-adv-compare .nw-adv-side .nw-adv-txt{
  max-height:none;overflow:visible;
  padding:0;border:0;background:none;border-radius:0;
  text-decoration:none;
  font-size:13px;line-height:1.74;
}
.nw-adv-txt{font-family:var(--nw-reading-font);}
.nw-adv-tag{
  color:var(--nw-ink-faint);font-size:var(--nw-fs-tiny);
  letter-spacing:.08em;
}
.nw-adv-issue,.nw-adv-why{color:var(--nw-ink-quiet);}
.nw-adv-foot{border-top:1px solid var(--nw-hair);}
.nw-adv-kind{
  border-radius:var(--nw-r-pill);
  background:var(--nw-accent-wash);
  color:var(--nw-ink-quiet);
  letter-spacing:.02em;
}
.nw-adv-btn[data-kind="accept"]{color:var(--nw-ok);border-color:color-mix(in srgb, var(--nw-ok) 30%, var(--nw-hair));}
.nw-adv-btn[data-kind="accept"]:hover{background:color-mix(in srgb, var(--nw-ok) 12%, transparent);}
.nw-adv-btn[data-kind="reject"]{color:var(--nw-ink-faint);}
.nw-adv-btn[data-kind="reject"]:hover{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 26%, var(--nw-hair));}
.nw-adv-mini{border-radius:var(--nw-r-sm);}
.nw-adv-mini[data-kind="apply"]{color:var(--nw-accent);}
.nw-accepted{
  border:1px solid var(--nw-hair);border-radius:var(--nw-r-md);
  background:var(--nw-sunken);
}
.nw-accepted-head{border-radius:var(--nw-r-md);}
.nw-acc-row{border-radius:var(--nw-r-sm);}
.nw-acc-row:hover{background:var(--nw-surface-2);}
.nw-acc-quote{font-family:var(--nw-reading-font);color:var(--nw-ink-quiet);}
.nw-acc-ord{color:var(--nw-ink-faint);font-variant-numeric:tabular-nums;}
.nw-suggest-foot{border-top:1px solid var(--nw-hair);}
.nw-suggest-grip:hover,.nw-suggest-grip[data-drag="1"]{background:var(--nw-accent-line);}
`);

  // ---------------------------------------------------------- status, misc --
  NW.CSS_PARTS.push(`
/* ============================================================== status ==== */
.nw-status{
  border-top:1px solid var(--nw-hair);
  background:color-mix(in srgb, var(--nw-bg) 86%, transparent);
  backdrop-filter:blur(8px);
  color:var(--nw-ink-faint);
  font-size:var(--nw-fs-tiny);
}
.nw-status-today{color:var(--nw-ink-quiet);}
/* The attribute 90-app.js has always set and nothing styled: today's delta
   reads up (green) or down (quiet). */
.nw-status-today[data-sign="up"]{color:var(--nw-ok);}
.nw-status-today[data-sign="down"]{color:var(--nw-ink-faint);}
.nw-status-mid{color:var(--nw-ink-faint);}
.nw-dot{border-radius:var(--nw-r-pill);}
.nw-dot[data-state="ok"]{background:var(--nw-ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-ok) 16%, transparent);}
.nw-dot[data-state="err"]{background:var(--nw-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-danger) 16%, transparent);}
.nw-dot[data-state="busy"]{background:var(--nw-brand);box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-brand) 16%, transparent);}

/* Badges: one tone vocabulary across both call sites. */
.nw-badge{border-radius:var(--nw-r-pill);border:1px solid var(--nw-hair);letter-spacing:.02em;}
.nw-badge[data-tone="brand"]{background:var(--nw-accent-wash);border-color:var(--nw-accent-line);color:var(--nw-accent);}
.nw-badge[data-tone="ok"]{background:color-mix(in srgb, var(--nw-ok) 12%, transparent);border-color:color-mix(in srgb, var(--nw-ok) 28%, var(--nw-hair));color:var(--nw-ok);}
.nw-badge[data-tone="danger"]{background:color-mix(in srgb, var(--nw-danger) 10%, transparent);border-color:color-mix(in srgb, var(--nw-danger) 26%, var(--nw-hair));color:var(--nw-danger);}
.nw-badge[data-tone="warn"]{background:color-mix(in srgb, var(--nw-warn) 12%, transparent);border-color:color-mix(in srgb, var(--nw-warn) 28%, var(--nw-hair));color:var(--nw-warn);}
.nw-badge[data-tone="info"]{background:var(--nw-sunken);border-color:var(--nw-hair);color:var(--nw-ink-quiet);}
.nw-badge[data-tone="idle"]{background:var(--nw-sunken);border-color:var(--nw-hair);color:var(--nw-ink-faint);}

/* Empty states: the medallion gets a soft halo instead of a flat 50% glyph. */
.nw-empty svg{opacity:.42;}
.nw-empty .nw-center{color:var(--nw-ink-faint);}
.nw-skel{border-radius:var(--nw-r-sm);}

/* Menus and popovers share one material with dialogs, at a lighter weight. */
.nw-shelf-menu,.nw-suggest-diff{
  border:1px solid var(--nw-hair);
  box-shadow:var(--nw-rise-2);
  background:var(--nw-surface-overlay);
}
.nw-shelf-menu-item{border-radius:var(--nw-r-sm);}
.nw-shelf-menu-item:hover{background:var(--nw-surface-2);}
.nw-shelf-menu-item.is-danger{color:var(--nw-danger);}

/* ============================================================== themes ==== */
/* Magazine is the palette the writer actually runs: red ink on white paper.
   It gets a slightly drier grain and one more notch of contrast in the meta. */
.nw-root[data-theme="magazine"]{
  --nw-ink-faint:color-mix(in srgb, var(--nw-fg) 52%, var(--nw-bg));
  --nw-accent-wash:color-mix(in srgb, var(--nw-brand) 7%, transparent);
}
.nw-root[data-theme="magazine"] .nw-welcome-card,
.nw-root[data-theme="magazine"] .nw-adv{
  border-color:color-mix(in srgb, var(--nw-fg) 11%, transparent);
}
/* Eye-care green needs the accent to stay dark, or nothing is legible on it. */
.nw-root[data-theme="eye"]{--nw-accent-wash:color-mix(in srgb, var(--nw-brand) 12%, transparent);}
/* Newspaper is square and inky: the accent rule gets wider, the shadows harder. */
.nw-root[data-theme="newspaper"] .nw-welcome-cardtitle::before{width:16px;height:2px;}
/* Night: the accent is light, so washes must be additive, not multiplicative. */
.nw-root[data-theme="night"]{
  --nw-accent-wash:color-mix(in srgb, var(--nw-brand) 14%, transparent);
  --nw-accent-wash-2:color-mix(in srgb, var(--nw-brand) 22%, transparent);
}
`);

  // ------------------------------------------------------------ lock: tint --
  // The lock screen is the only hand-painted view in the plugin (it draws its
  // own study). Its palette stays, but the padlock glow now inherits the theme's
  // brand so night/magazine no longer show a claude-coloured library.
  NW.CSS_PARTS.push(`
/* ================================================================ lock ==== */
.nw-lock .nw-lock-rule{background:linear-gradient(90deg, transparent, var(--nw-accent), transparent);}
.nw-lock .nw-lock-eyebrow{letter-spacing:.24em;}
.nw-lock-title{letter-spacing:-.01em;}
.nw-lock-input:focus{box-shadow:0 1px 0 var(--nw-accent);}
.nw-lock-go:not([disabled]){
  box-shadow:0 8px 20px -10px color-mix(in srgb, var(--nw-accent) 70%, transparent);
}
`);
})();
