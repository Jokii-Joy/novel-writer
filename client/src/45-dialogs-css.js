;(() => {
  'use strict';

  // ===========================================================================
  // 45-dialogs-css.js — the dialog / side-panel layer.
  //
  // Owns: .nw-center (first-run + no-chapter stage), .nw-side (shelf column
  //        frame), segmented controls, the lock screen, the settings panel, the
  //        keybinding list, the AI suggestion list, the typeset diff, the cloud
  //        login box, version history, and the R3 panels the submission flow
  //        introduced (journal list/detail, genre segments, mail preview,
  //        change list, signature, fold, badge, theme swatches).
  //
  // Consumes the tokens published by 05-css.js (--nw-fs-*, --nw-r-*, --nw-sp-*,
  // --nw-shadow-*, --nw-line*, --nw-surface-*, --nw-brand, …) so a single scale
  // governs the whole shell. 96-motion.js runs just before 97-theme.js; the
  // final polish pass lives there.
  //
  // One deliberate exception to "tokens only": the theme swatches in the
  // appearance panel are palette *samples* — their whole job is to show the
  // paper, ink and accent of a theme that is not the one currently active, so
  // they carry those three literals (the same values 98-shell-theme.js maps
  // into the shell) and nothing else.
  // ===========================================================================
  NW.CSS_PARTS.push(`
/* ---------------------------------------------------------- centre stage -- */
.nw-center{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--nw-sp-3);
  height:100%;width:100%;padding:var(--nw-sp-6);color:var(--nw-fg-soft);
  font-size:var(--nw-fs-base);line-height:var(--nw-lh-base);text-align:center;
  background:
    radial-gradient(760px 340px at 50% 38%, color-mix(in srgb, var(--nw-brand) 4%, transparent), transparent 72%),
    var(--nw-bg);
}
.nw-center > p{margin:0;max-width:46ch;}

/* --------------------------------------------------------- shelf column --- */
.nw-side{
  flex:0 0 auto;min-width:0;display:flex;flex-direction:column;height:100%;overflow:hidden;
  background:var(--dsw-specific-sidebar-fill, var(--nw-surface-1));
  border-right:1px solid var(--nw-line-soft);
}

/* ------------------------------------------------------------- controls --- */
/* One segmented-control skin serves both .nw-seg (generic) and .nw-genre-seg
   (the genre picker in the submission dialog). */
.nw-seg,
.nw-genre-seg{
  display:inline-flex;gap:3px;flex-wrap:wrap;padding:3px;border-radius:var(--nw-r-control);
  background:var(--nw-surface-2);border:1px solid var(--nw-line);
}
.nw-seg > .nw-btn,
.nw-genre-seg > .nw-btn{
  height:32px;padding:0 14px;border-color:transparent;background:transparent;
  box-shadow:none;font-size:var(--nw-fs-second);font-weight:500;color:var(--nw-fg-soft);
}
.nw-seg > .nw-btn:hover:not(:disabled),
.nw-genre-seg > .nw-btn:hover:not(:disabled){
  background:color-mix(in srgb, var(--nw-surface-overlay) 80%, transparent);
  color:var(--nw-fg);transform:none;
}
.nw-seg > .nw-btn[data-active="1"],
.nw-seg > .nw-btn[data-kind="primary"],
.nw-genre-seg > .nw-btn[data-active="1"],
.nw-genre-seg > .nw-btn[data-kind="primary"]{
  background:var(--nw-surface-overlay);color:var(--nw-fg);font-weight:600;
  border-color:var(--nw-line);box-shadow:var(--nw-shadow-1);
}
.nw-seg > .nw-btn[data-kind="primary"]:hover:not(:disabled),
.nw-genre-seg > .nw-btn[data-kind="primary"]:hover:not(:disabled){
  background:var(--nw-surface-overlay);color:var(--nw-fg);
}
.nw-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--nw-sp-3);}
.nw-hint-block{
  margin:var(--nw-sp-1) 0 0;font-size:var(--nw-fs-second);line-height:1.7;color:var(--nw-fg-soft);
}
.nw-link{
  color:var(--nw-brand);word-break:break-all;font-size:inherit;text-decoration:none;
  border-bottom:1px solid color-mix(in srgb, var(--nw-brand) 30%, transparent);
  transition:border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-link:hover{border-bottom-color:var(--nw-brand);}

/* ---------------------------------------------------------------- badge --- */
/* Tiny status pill: "待核对" on a journal without a verified address, counts,
   format tags. Tone is opt-in; the neutral tone is the default. */
.nw-badge{
  display:inline-flex;align-items:center;gap:4px;
  padding:1px 9px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line);background:var(--nw-surface-2);
  font-size:var(--nw-fs-micro);font-weight:500;line-height:1.65;letter-spacing:.02em;
  color:var(--nw-fg-soft);white-space:nowrap;vertical-align:1px;
}
.nw-badge[data-tone="warn"],.nw-badge[data-kind="warn"]{
  color:var(--nw-warn);border-color:color-mix(in srgb, var(--nw-warn) 30%, transparent);
  background:color-mix(in srgb, var(--nw-warn) 10%, transparent);
}
.nw-badge[data-tone="ok"],.nw-badge[data-kind="ok"]{
  color:var(--nw-ok);border-color:color-mix(in srgb, var(--nw-ok) 30%, transparent);
  background:color-mix(in srgb, var(--nw-ok) 10%, transparent);
}
.nw-badge[data-tone="danger"],.nw-badge[data-kind="danger"]{
  color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 30%, transparent);
  background:color-mix(in srgb, var(--nw-danger) 9%, transparent);
}
.nw-badge[data-tone="brand"],.nw-badge[data-kind="brand"]{
  color:var(--nw-brand);border-color:color-mix(in srgb, var(--nw-brand) 28%, transparent);
  background:color-mix(in srgb, var(--nw-brand) 8%, transparent);
}

/* ----------------------------------------------------------------- fold --- */
/* Progressively disclosed block (cloud "advanced" settings, journal details).
   Works on <details class="nw-fold"> and on a div+summary pair alike. */
.nw-fold{
  margin-top:var(--nw-sp-2);border-top:1px solid var(--nw-line-soft);
  font-size:var(--nw-fs-second);color:var(--nw-fg-soft);
}
.nw-fold > summary,
.nw-fold > .nw-fold-head{
  display:flex;align-items:center;gap:var(--nw-sp-1);
  padding:var(--nw-sp-2) 0;cursor:pointer;list-style:none;
  font-size:var(--nw-fs-second);font-weight:500;color:var(--nw-fg);
  user-select:none;
}
.nw-fold > summary::-webkit-details-marker{display:none;}
.nw-fold > summary::before{
  content:'';flex:0 0 auto;width:6px;height:6px;margin-left:2px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(-45deg);opacity:.6;
  transition:transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-fold[open] > summary::before{transform:rotate(45deg);}
.nw-fold > summary:hover{color:var(--nw-brand);}
.nw-fold > summary:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;border-radius:var(--nw-r-hair);}
.nw-fold > *:not(summary):not(.nw-fold-head){margin-top:2px;}
/* dialog3's foldBox() is a div pair rather than <details>: .nw-fold-open marks
   the expanded state and .nw-fold-body holds the revealed content. The head is
   a wrapper around a ghost button, so the "open" cue has to be re-stated on the
   button or it would keep the muted ghost colour. */
.nw-fold-open > .nw-fold-head{color:var(--nw-fg);}
.nw-fold-open > .nw-fold-head .nw-btn{color:var(--nw-fg);font-weight:600;}
.nw-fold-body{
  display:flex;flex-direction:column;gap:var(--nw-sp-2);
  padding:0 0 var(--nw-sp-2);
  animation:nw-fade-up var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease) both;
}

/* ----------------------------------------------------------- lock screen -- */
.nw-lock{
  display:flex;align-items:center;justify-content:center;height:100%;width:100%;padding:var(--nw-sp-6);
  position:relative;overflow:hidden;
  background:
    radial-gradient(1200px 520px at 50% -16%, color-mix(in srgb, var(--nw-brand) 12%, transparent), transparent 72%),
    radial-gradient(680px 380px at 82% 108%, color-mix(in srgb, var(--nw-brand) 6%, transparent), transparent 70%),
    var(--nw-bg);
}
/* faint ruled-page texture: the lock screen should read as paper, not a form */
.nw-lock::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(180deg,
    transparent 0,transparent 33px,
    color-mix(in srgb, var(--nw-line) 62%, transparent) 33px,
    color-mix(in srgb, var(--nw-line) 62%, transparent) 34px);
  -webkit-mask-image:radial-gradient(640px 480px at 50% 46%, var(--nw-fg) 10%, transparent 74%);
  mask-image:radial-gradient(640px 480px at 50% 46%, var(--nw-fg) 10%, transparent 74%);
  opacity:.5;
}
.nw-lock-card{
  position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--nw-sp-2);
  width:100%;max-width:392px;padding:38px 32px 30px;
  border-radius:var(--nw-r-modal);border:1px solid var(--nw-line-soft);
  background:var(--nw-surface-overlay);box-shadow:var(--nw-shadow-3);color:var(--nw-fg);
  animation:nw-fade-up var(--nw-dur-long,var(--nw-dur-long)) var(--nw-ease,ease) both;
}
/* a thin brand rule across the top of the card, like a book's headband */
.nw-lock-card::before{
  content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);
  width:76px;height:3px;border-radius:0 0 3px 3px;
  background:linear-gradient(90deg, transparent, var(--nw-brand), transparent);
}
.nw-lock-card > svg{color:var(--nw-brand);opacity:.92;margin-bottom:2px;}
.nw-lock-title{
  margin:var(--nw-sp-1) 0 0;font-family:var(--nw-reading-font);
  font-size:19px;font-weight:600;letter-spacing:.02em;
}
.nw-lock-hint{
  margin:0 0 var(--nw-sp-2);font-size:var(--nw-fs-second);color:var(--nw-fg-soft);
  text-align:center;line-height:1.7;max-width:32ch;
}
.nw-lock-input{
  text-align:center;letter-spacing:.16em;font-size:var(--nw-fs-base);height:var(--nw-h-input);
  font-variant-numeric:tabular-nums;
}
.nw-lock-input::placeholder{letter-spacing:.04em;}
.nw-lock-error{
  width:100%;margin-top:var(--nw-sp-1);padding:8px 12px;border-radius:var(--nw-r-control);
  font-size:var(--nw-fs-micro);line-height:1.6;color:var(--nw-danger);
  background:color-mix(in srgb, var(--nw-danger) 10%, transparent);
  border:1px solid color-mix(in srgb, var(--nw-danger) 30%, transparent);
}
.nw-lock-actions{
  display:flex;gap:var(--nw-sp-2);margin-top:var(--nw-sp-2);width:100%;justify-content:center;
}

/* ------------------------------------------------------------- settings --- */
/* Two columns (R5): tab rail on the left, one section's form on the right. The
   pane is the only scroll container, so switching tabs never moves the rail. */
.nw-settings{
  display:grid;grid-template-columns:150px minmax(0,1fr);
  gap:var(--nw-sp-4);align-items:start;min-height:0;
}
.nw-settings-nav{
  display:flex;flex-direction:column;gap:2px;
  position:sticky;top:0;
}
.nw-settings-navbtn{
  display:flex;align-items:center;gap:var(--nw-sp-1);width:100%;
  height:34px;padding:0 10px;border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-fg-soft);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-second);line-height:1;text-align:left;
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-settings-navbtn:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-settings-navbtn[data-active="1"]{
  background:color-mix(in srgb, var(--nw-brand) 12%, transparent);
  color:var(--nw-brand);font-weight:600;border-color:transparent;
}
.nw-settings-navbtn:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-settings-navbtn > svg{flex:0 0 auto;}

.nw-settings-pane{min-width:0;max-height:min(62vh,560px);overflow:auto;padding-right:2px;}
/* Only the selected section is laid out; the rest stay mounted (so their async
   loaders do not re-run on every tab switch) but cost no vertical space. */
.nw-settings-pane > .nw-settings-section{display:none;}
.nw-settings-pane > .nw-settings-section[data-on="1"]{display:block;}

/* R13: measured against the plugin's own column, not the window (see 05-css
   container-type / the tiers in 98b-responsive.js). */
@container nw (max-width: 780px){
  .nw-settings{grid-template-columns:minmax(0,1fr);}
  .nw-settings-nav{flex-direction:row;flex-wrap:wrap;position:static;}
  .nw-settings-navbtn{width:auto;padding:0 12px;}
  .nw-settings-pane{max-height:none;}
}

.nw-settings-section{
  margin-bottom:var(--nw-sp-4);padding:var(--nw-sp-4) var(--nw-sp-4) 8px;
  border-radius:var(--nw-r-card);border:1px solid var(--nw-line-soft);
  background:var(--nw-surface-1);
}
.nw-settings-section:last-child{margin-bottom:4px;}
.nw-settings-section > h3{
  margin:0 0 var(--nw-sp-2);padding-bottom:var(--nw-sp-1);font-size:var(--nw-fs-base);font-weight:600;
  letter-spacing:.02em;color:var(--nw-fg);
  border-bottom:1px solid var(--nw-line-soft);
}
/* rows now live inside the card, so they shed the doubled outer rule */
.nw-settings-section .nw-row{padding:12px 0;border-bottom-color:var(--nw-line-soft);}
.nw-settings-section .nw-row:last-child{border-bottom:none;padding-bottom:var(--nw-sp-0);}
/* R16 ⑥: a row may carry an explanation under its label. */
.nw-rowlabel{display:flex;flex-direction:column;gap:2px;min-width:0;}
.nw-rowhint{font-size:var(--nw-fs-micro);line-height:1.45;max-width:52ch;}

/* SMTP provider presets — small pill buttons, one per mail service. */
.nw-preset-wrap{display:flex;flex-wrap:wrap;gap:var(--nw-sp-0);}
.nw-preset{
  height:30px;padding:0 12px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-overlay);
  color:var(--nw-fg);cursor:pointer;font-family:inherit;font-size:var(--nw-fs-micro);line-height:1;
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-preset:hover{background:var(--nw-surface-2);border-color:var(--nw-line);}
.nw-preset:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

.nw-kbd-list{display:flex;flex-direction:column;gap:2px;}.nw-kbd-row{
  display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-3);
  font-size:var(--nw-fs-second);color:var(--nw-fg-soft);padding:6px 0;
}
.nw-kbd-row kbd{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--nw-fs-micro);
  padding:2px 8px;border-radius:var(--nw-r-control);border:1px solid var(--nw-line);border-bottom-width:2px;
  background:var(--nw-surface-2);color:var(--nw-fg);white-space:nowrap;
}

/* ------------------------------------------------------ theme choices ---- */
/* dialog3 renders   button.nw-choice > span.nw-theme-swatch + span.nw-choice-label.
   The BUTTON is the card (border, padding, hover lift, active ring); the swatch
   is only the colour block inside it. Written the other way round — a card
   inside a button — the appearance panel showed a card nested in a card. */
.nw-choice{
  display:flex;flex-direction:column;align-items:stretch;gap:var(--nw-sp-0);
  padding:var(--nw-sp-0);border-radius:var(--nw-r-card);min-width:0;
  border:1px solid var(--nw-line);background:var(--nw-surface-1);
  font:inherit;font-size:var(--nw-fs-micro);font-weight:500;
  color:var(--nw-fg-soft);cursor:pointer;text-align:center;
  transition:border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-choice:hover{transform:translateY(-1px);border-color:var(--nw-line-strong);box-shadow:var(--nw-shadow-1);}
.nw-choice:active{transform:translateY(0);}
.nw-choice:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
/* .nw-choice-on is a class, not an attribute; the aria/data spellings are kept
   because the swatch mirrors the state as data-active / aria-checked. */
.nw-choice.nw-choice-on,
.nw-choice[aria-pressed="true"],
.nw-choice[data-active="1"]{
  border-color:color-mix(in srgb, var(--nw-brand) 48%, var(--nw-line));
  box-shadow:0 0 0 3px color-mix(in srgb, var(--nw-brand) 12%, transparent);
  color:var(--nw-fg);font-weight:600;
}
.nw-choice-label{
  display:block;min-width:0;
  font-size:var(--nw-fs-micro);font-weight:inherit;color:inherit;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
/* the swatch is a paint chip and nothing else — no border-radius-card, no
   padding, no surface; the frame belongs to the button around it */
.nw-theme-swatch{
  display:block;width:100%;height:34px;padding:0;overflow:hidden;
  border-radius:var(--nw-r-control);border:1px solid rgba(0,0,0,.10);
  background:transparent;pointer-events:none;
}
.nw-theme-swatch::before{
  content:'';display:block;width:100%;height:100%;
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.55), transparent 62%),
    linear-gradient(160deg, #faf9f5, #f3f0e7);
}
/* palette samples - keep in sync with 98-shell-theme.js (five themes since R19) */
.nw-theme-swatch[data-theme="claude"]::before,
.nw-theme-swatch[data-theme-id="claude"]::before,
.nw-theme-swatch[data-value="claude"]::before{
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.5), transparent 62%),
    linear-gradient(160deg,#fdf7ec,#ecdcc0);
  box-shadow:inset 0 -12px 20px -14px rgba(196,83,47,.75);
}
.nw-theme-swatch[data-theme="eye"]::before,
.nw-theme-swatch[data-theme-id="eye"]::before,
.nw-theme-swatch[data-value="eye"]::before{
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.5), transparent 62%),
    linear-gradient(160deg,#cce8cf,#b9dcbd);
}
.nw-theme-swatch[data-theme="night"]::before,
.nw-theme-swatch[data-theme-id="night"]::before,
.nw-theme-swatch[data-value="night"]::before{
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.14), transparent 62%),
    linear-gradient(160deg,#24241f,#161614);
}
/* on a dark chip the default black hairline disappears, so the frame of the
   swatch itself lightens for that palette */
.nw-theme-swatch[data-theme="night"],
.nw-theme-swatch[data-theme-id="night"],
.nw-theme-swatch[data-value="night"]{border-color:rgba(255,255,255,.16);}
.nw-theme-swatch[data-theme="newspaper"]::before,
.nw-theme-swatch[data-theme-id="newspaper"]::before,
.nw-theme-swatch[data-value="newspaper"]::before{
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.38), transparent 62%),
    linear-gradient(160deg,#f4ead0,#d8c69c);
  box-shadow:inset 0 -12px 20px -14px rgba(140,43,34,.62);
}
.nw-theme-swatch[data-theme="magazine"]::before,
.nw-theme-swatch[data-theme-id="magazine"]::before,
.nw-theme-swatch[data-value="magazine"]::before{
  background:
    radial-gradient(120% 140% at 18% 0%, rgba(255,255,255,.95), transparent 62%),
    linear-gradient(160deg,#ffffff,#eef0f2);
  box-shadow:inset 0 -12px 20px -14px rgba(208,2,27,.78);
}
/* ------------------------------------------------------- AI suggestions --- */
.nw-suggest-list{
  display:flex;flex-direction:column;gap:var(--nw-sp-2);max-height:52vh;overflow:auto;padding-right:2px;
}
.nw-suggest{
  display:flex;align-items:flex-start;gap:var(--nw-sp-3);
  padding:var(--nw-sp-3);border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);
  transition:border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-suggest:hover{border-color:var(--nw-line);box-shadow:var(--nw-shadow-1);}
.nw-suggest[data-on="1"]{
  border-color:color-mix(in srgb, var(--nw-brand) 46%, var(--nw-line));
  background:color-mix(in srgb, var(--nw-brand) 6%, var(--nw-surface-1));
  box-shadow:inset 3px 0 0 var(--nw-brand);
}
.nw-suggest > input{
  margin:4px 0 0;flex:0 0 auto;cursor:pointer;width:17px;height:17px;accent-color:var(--nw-brand);
}
.nw-suggest-body{flex:1 1 auto;min-width:0;}
.nw-suggest-diff{font-size:var(--nw-fs-second);line-height:1.75;word-break:break-word;}
.nw-suggest-diff del{color:var(--nw-danger);text-decoration:line-through;opacity:.9;}
.nw-suggest-diff ins{color:var(--nw-ok);text-decoration:none;font-weight:600;}
.nw-suggest-arrow{color:var(--nw-fg-soft);opacity:.65;margin:0 2px;}
.nw-suggest-reason{margin-top:4px;font-size:var(--nw-fs-micro);line-height:1.6;color:var(--nw-fg-soft);}
.nw-suggest-type{
  display:inline-block;margin-top:var(--nw-sp-0);padding:2px 9px;border-radius:var(--nw-r-pill);
  font-size:var(--nw-fs-micro);letter-spacing:.02em;color:var(--nw-warn);
  background:color-mix(in srgb, var(--nw-warn) 11%, transparent);
  border:1px solid color-mix(in srgb, var(--nw-warn) 26%, transparent);
}
.nw-suggest-actions{display:flex;flex-direction:column;gap:var(--nw-sp-0);flex:0 0 auto;}

/* ---------------------------------------------------------- typeset diff -- */
.nw-diff{
  max-height:52vh;overflow:auto;border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);padding:var(--nw-sp-2);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:var(--nw-fs-micro);line-height:1.75;
}
.nw-diff-row{
  display:flex;gap:var(--nw-sp-1);padding:3px 8px;border-radius:var(--nw-r-control);
  white-space:pre-wrap;word-break:break-word;
}
.nw-diff-row[data-type="add"]{background:color-mix(in srgb, var(--nw-ok) 13%, transparent);}
.nw-diff-row[data-type="del"]{background:color-mix(in srgb, var(--nw-danger) 12%, transparent);}
.nw-diff-mark{flex:0 0 auto;width:12px;opacity:.7;text-align:center;}
.nw-diff-text{min-width:0;}

/* ----------------------------------------------------------- cloud login -- */
.nw-login-box{
  margin-top:var(--nw-sp-2);padding:var(--nw-sp-3);border-radius:var(--nw-r-card);
  border:1px dashed var(--nw-line-strong);background:var(--nw-surface-1);
  font-size:var(--nw-fs-second);line-height:1.75;
  display:flex;flex-direction:column;gap:var(--nw-sp-1);
}

/* -------------------------------------------------------------- versions -- */
/* 读信 (R12 ④). The body is a <pre> because a submission reply quotes the
   manuscript verbatim — reflowing it would destroy the line breaks the editor
   is referring to. */
.nw-mail{display:flex;flex-direction:column;gap:var(--nw-sp-3);min-height:0;}
.nw-mail-meta{
  display:flex;flex-direction:column;gap:4px;
  padding-bottom:var(--nw-sp-3);border-bottom:1px solid var(--nw-line-soft);
}
.nw-mail-subject{font-size:var(--nw-fs-base);font-weight:600;line-height:1.5;color:var(--nw-fg);word-break:break-word;}
.nw-mail-from{font-size:var(--nw-fs-second);color:var(--nw-fg-soft);}
.nw-mail-date{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);}
.nw-mail-body{
  margin:0;max-height:52vh;overflow:auto;
  font-family:var(--nw-reading-font,inherit);font-size:var(--nw-fs-second);line-height:1.85;
  white-space:pre-wrap;word-break:break-word;color:var(--nw-fg);
}
.nw-mail-loading{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--nw-sp-2);
  min-height:180px;text-align:center;font-size:var(--nw-fs-second);color:var(--nw-fg-soft);
}
.nw-version-list{
  display:flex;flex-direction:column;max-height:46vh;overflow:auto;border-radius:var(--nw-r-card);
}
.nw-preview-box{
  margin-top:var(--nw-sp-2);padding:var(--nw-sp-3);border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);
}
.nw-preview-text{
  margin:0;max-height:30vh;overflow:auto;font-size:var(--nw-fs-second);line-height:1.8;
  white-space:pre-wrap;word-break:break-word;color:var(--nw-fg);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}

/* =================================================== submission (R3 new) == */
/* Three steps: journal picker, manuscript picker, mail preview. */
/* minmax(min(200px,100%),…) — a hard 200px floor overflows the moment the
   dialog is wider than the panel it lives in. */
.nw-submit-grid{
  display:grid;grid-template-columns:minmax(min(200px,100%),.92fr) minmax(0,1.08fr);
  gap:var(--nw-sp-4);align-items:start;min-height:260px;
}
.nw-submit-grid > *{min-width:0;}
@container nw (max-width: 780px){
  .nw-submit-grid{grid-template-columns:minmax(0,1fr);min-height:0;gap:var(--nw-sp-3);}
}

.nw-journal-list{
  display:flex;flex-direction:column;gap:2px;max-height:46vh;overflow:auto;
  padding-right:2px;margin:0;list-style:none;
}
.nw-journal-item{
  display:flex;align-items:center;justify-content:space-between;gap:var(--nw-sp-2);
  padding:9px 10px;border-radius:var(--nw-r-control);
  border:1px solid transparent;background:transparent;
  font-size:var(--nw-fs-second);color:var(--nw-fg);cursor:pointer;text-align:left;min-width:0;
  transition:background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-journal-item:hover{background:var(--nw-surface-2);}
.nw-journal-item[data-active="1"]{
  background:color-mix(in srgb, var(--nw-brand) 7%, var(--nw-surface-1));
  border-color:color-mix(in srgb, var(--nw-brand) 26%, transparent);
  box-shadow:inset 3px 0 0 var(--nw-brand);
  font-weight:600;
}
.nw-journal-item > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* R16 ⑩: name keeps its room; the tier chip never truncates. */
.nw-journal-item > .nw-journal-name{flex:1 1 auto;}
.nw-journal-item > .nw-journal-tags{
  display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;
  overflow:visible;white-space:nowrap;
}

.nw-journal-detail{
  padding:var(--nw-sp-3) var(--nw-sp-4);border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);
  font-size:var(--nw-fs-second);line-height:1.75;color:var(--nw-fg-soft);
  max-height:46vh;overflow:auto;
}
.nw-journal-detail > h4,
.nw-journal-detail > strong:first-child{
  display:block;margin:0 0 6px;
  font-family:var(--nw-reading-font);font-size:var(--nw-fs-title);font-weight:600;
  letter-spacing:.01em;color:var(--nw-fg);
}
.nw-journal-detail dl{display:grid;grid-template-columns:auto 1fr;gap:4px var(--nw-sp-2);margin:var(--nw-sp-2) 0 0;}
.nw-journal-detail dt{color:var(--nw-fg-soft);font-size:var(--nw-fs-micro);}
.nw-journal-detail dd{margin:0;color:var(--nw-fg);font-size:var(--nw-fs-second);word-break:break-word;}
.nw-journal-detail ul{margin:var(--nw-sp-1) 0 0;padding-left:1.1em;}
.nw-journal-detail li{margin:2px 0;}

.nw-submit-mail{
  display:flex;flex-direction:column;gap:var(--nw-sp-2);
  padding:var(--nw-sp-3);border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);
}
.nw-submit-mail > label,
.nw-submit-mail .nw-row{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);}
.nw-submit-mail .nw-textarea{min-height:180px;font-family:var(--nw-reading-font);font-size:var(--nw-fs-second);}

.nw-submit-changes{
  display:flex;flex-direction:column;gap:4px;
  margin:var(--nw-sp-2) 0 0;padding:0;list-style:none;
  font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);
  max-height:22vh;overflow:auto;
}
.nw-submit-changes > li,
.nw-submit-changes > div{
  display:flex;align-items:baseline;gap:var(--nw-sp-1);
  padding:4px 8px;border-radius:var(--nw-r-control);background:var(--nw-surface-2);
  line-height:1.6;word-break:break-word;
}
.nw-submit-changes del{color:var(--nw-danger);text-decoration:line-through;}
.nw-submit-changes ins{color:var(--nw-ok);text-decoration:none;}

/* The closing signature line: the one place the UI is allowed to be literary. */
.nw-signature{
  display:block;margin-top:var(--nw-sp-3);padding-top:var(--nw-sp-2);
  border-top:1px dashed var(--nw-line);
  font-family:var(--nw-reading-font);font-size:var(--nw-fs-second);line-height:1.8;
  color:var(--nw-fg-soft);text-align:right;white-space:pre-wrap;word-break:break-word;
}

/* decorative hairline, available to any panel that wants one */
.nw-rule{height:1px;border:0;margin:var(--nw-sp-3) 0;background:linear-gradient(90deg, var(--nw-line), transparent);}
/* ------------------------------------------------- submission preview ---- */
/* Journal recommendation strip on step 1: a compact row of ranked chips with the
   reason that earned the rank, so the score is auditable rather than magic. */
.nw-reco{
  margin-bottom:var(--nw-sp-3);padding:10px 12px;
  border-radius:var(--nw-r-card);border:1px solid var(--nw-line-soft);
  background:color-mix(in srgb, var(--nw-brand) 5%, var(--nw-surface-1));
}
.nw-reco-head{
  display:flex;align-items:center;gap:var(--nw-sp-0);margin-bottom:var(--nw-sp-1);
  font-size:var(--nw-fs-micro);font-weight:600;color:var(--nw-brand);
}
.nw-reco-list{display:flex;flex-wrap:wrap;gap:var(--nw-sp-0);}
.nw-reco-item{
  display:flex;flex-direction:column;align-items:flex-start;gap:1px;
  padding:6px 10px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-overlay);
  color:var(--nw-fg);cursor:pointer;font-family:inherit;text-align:left;
  transition:border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-reco-item:hover{background:var(--nw-surface-2);border-color:var(--nw-line);}
.nw-reco-item:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
/* R27 ③: the model reports a quality verdict per journal, so the row is now
   name + verdict badge on one line and the reason underneath. The badge is a
   chip, not a score: a number here would read as a promise the editor cannot
   make. */
.nw-reco-line{display:flex;align-items:center;gap:6px;min-width:0;}
.nw-reco-fit{
  flex:0 0 auto;padding:0 5px;border-radius:var(--nw-r-pill);
  font-size:var(--nw-fs-tiny);line-height:1.6;font-weight:500;
  color:var(--nw-fg-soft);background:var(--nw-sunken);
  border:1px solid var(--nw-line-soft);
}
.nw-reco-note{
  margin:0 0 var(--nw-sp-1);font-size:var(--nw-fs-tiny);line-height:1.45;
  color:var(--nw-fg-soft);
}
.nw-reco-name{font-size:var(--nw-fs-second);font-weight:500;}
.nw-reco-why{font-size:var(--nw-fs-tiny);line-height:1.3;color:var(--nw-fg-soft);}

/* ------------------------------------------------------- submission log --- */
.nw-submit-filters{display:flex;flex-wrap:wrap;gap:var(--nw-sp-0);margin-bottom:var(--nw-sp-2);}
.nw-chip{
  height:28px;padding:0 12px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line-soft);background:transparent;color:var(--nw-fg-soft);
  cursor:pointer;font-family:inherit;font-size:var(--nw-fs-micro);line-height:1;
  transition:background-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-chip:hover{background:var(--nw-sunken);color:var(--nw-fg);}
.nw-chip[data-active="1"]{
  background:color-mix(in srgb, var(--nw-brand) 14%, transparent);
  border-color:transparent;color:var(--nw-brand);font-weight:600;
}
.nw-chip:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

.nw-submit-table{display:flex;flex-direction:column;gap:var(--nw-sp-0);}
.nw-submit-line{
  display:flex;align-items:center;gap:var(--nw-sp-3);
  padding:8px 10px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line-soft);background:var(--nw-surface-1);
}
.nw-submit-line-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}
.nw-submit-line-title{font-size:var(--nw-fs-second);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-submit-line-meta{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-submit-line-actions{display:flex;align-items:center;gap:var(--nw-sp-0);flex:0 0 auto;}

/* -------------------------------------------------------- journal table --- */
.nw-journal-toolbar{display:flex;gap:var(--nw-sp-0);margin-bottom:var(--nw-sp-1);}
.nw-journal-toolbar > :first-child{flex:1 1 auto;min-width:0;}
.nw-journal-table{
  display:flex;flex-direction:column;gap:2px;
  max-height:min(46vh,420px);overflow:auto;padding-right:2px;
}
.nw-journal-row{
  display:flex;align-items:center;gap:var(--nw-sp-2);
  padding:7px 9px;border-radius:var(--nw-r-control);
  border:1px solid transparent;
}
.nw-journal-row:hover{background:var(--nw-sunken);}
.nw-journal-row-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto;}
.nw-journal-row-name{font-size:var(--nw-fs-second);font-weight:500;}
.nw-journal-row-meta{font-size:var(--nw-fs-tiny);color:var(--nw-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nw-journal-edit{
  margin-top:var(--nw-sp-3);padding:var(--nw-sp-3);
  border-radius:var(--nw-r-card);border:1px solid var(--nw-line-soft);
  background:var(--nw-surface-1);
}
.nw-journal-edit h4{margin:0 0 10px;}

/* ③ 邮件预览 —— 附件不再只列文件名，每个附件都能打开看正文 */
.nw-attach-list{display:flex;flex-wrap:wrap;gap:var(--nw-sp-0);align-items:center;}
.nw-attach-chip{
  display:inline-flex;align-items:center;gap:var(--nw-sp-0);
  max-width:100%;padding:2px 4px 2px 8px;
  border-radius:var(--nw-r-pill);border:1px solid var(--nw-line-soft);
  background:var(--nw-surface-1);
}
.nw-attach-name{
  font-size:var(--nw-fs-tiny);color:var(--nw-fg-soft);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:15em;
}
.nw-attach-open{
  flex:0 0 auto;padding:2px 8px;
  font:inherit;font-size:var(--nw-fs-tiny);line-height:1.6;
  color:var(--nw-brand);background:color-mix(in srgb, var(--nw-brand) 12%, transparent);
  border:none;border-radius:var(--nw-r-pill);cursor:pointer;
}
.nw-attach-open:hover{filter:brightness(.96);}
.nw-attach-open:disabled{opacity:.55;cursor:default;}
.nw-attach-open:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-attach-text{
  margin:0;padding:var(--nw-sp-3);
  max-height:52vh;overflow:auto;
  white-space:pre-wrap;word-break:break-word;
  font-family:var(--nw-reading-font);font-size:var(--nw-fs-second);line-height:1.9;
  color:var(--nw-fg);background:var(--nw-surface-1);
  border-radius:var(--nw-r-card);border:1px solid var(--nw-line-soft);
}
.nw-attach-hint{
  display:block;margin-top:2px;
  font-size:var(--nw-fs-micro);line-height:1.6;color:var(--nw-fg-soft);
}
/* R10 ⑥: the list of every inbox a journal registers. The row that will receive
   this manuscript is the only one that carries the brand tint, so "which
   address am I actually sending to" is answerable at a glance. */
.nw-variant-list{
  list-style:none;margin:4px 0 0;padding:0;
  display:flex;flex-direction:column;gap:4px;
}
.nw-variant-row{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--nw-sp-0);
  padding:4px 8px;border-radius:var(--nw-r-control);
  border:1px solid transparent;
  font-size:var(--nw-fs-second);line-height:1.6;
}
.nw-variant-row[data-on="1"]{
  background:var(--nw-surface-2);border-color:var(--nw-line);
}
.nw-variant-mail{
  font-family:var(--nw-mono-font,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  font-size:var(--nw-fs-micro);word-break:break-all;color:var(--nw-fg);
}
.nw-variant-row[data-on="1"] .nw-variant-mail{font-weight:600;}
.nw-variant-row .nw-attach-hint{margin-top:0;}
.nw-variant-pick{
  font-size:var(--nw-fs-micro);font-weight:600;
  color:var(--nw-brand);white-space:nowrap;
}

/* ---------------------------------------------------- R32 ② 逐条邮箱编辑 ---
   One bordered block per inbox. The address gets the full width so it is never
   truncated; the 体裁 chips sit directly under it and the 字数区间 + delete share a
   row, because those two are what the author changes least often. */
.nw-emailrows{display:flex;flex-direction:column;gap:8px;margin-top:8px;}
.nw-emailrow{
  display:flex;flex-direction:column;gap:6px;
  padding:10px;border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-sunken);
}
.nw-emailrow-tags{display:flex;flex-wrap:wrap;gap:5px;}
.nw-emailrow-chip{
  height:24px;padding:0 9px;border-radius:999px;
  border:1px solid var(--nw-line-strong);background:transparent;
  color:var(--nw-fg-soft);font-family:inherit;font-size:var(--nw-fs-micro);
  line-height:1;cursor:pointer;
  transition:background var(--nw-dur) var(--nw-ease),color var(--nw-dur) var(--nw-ease),border-color var(--nw-dur) var(--nw-ease);
}
.nw-emailrow-chip:hover{border-color:var(--nw-brand);color:var(--nw-brand);}
.nw-emailrow-chip[data-on="1"]{
  background:color-mix(in srgb, var(--nw-brand) 12%, transparent);
  border-color:color-mix(in srgb, var(--nw-brand) 55%, transparent);
  color:var(--nw-brand);font-weight:600;
}
.nw-emailrow-side{display:flex;gap:6px;align-items:center;}
.nw-emailrow-side > *:first-child{flex:1 1 auto;}

/* R32: the library list shows every stored inbox, one per line. */
.nw-journal-mails{display:flex;flex-direction:column;gap:2px;margin-top:2px;}
.nw-journal-mail{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;line-height:1.5;}
.nw-journal-mailaddr{
  font-family:var(--nw-mono, ui-monospace, monospace);
  font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);
  word-break:break-all;
}
.nw-journal-mail[data-main="1"] .nw-journal-mailaddr{color:var(--nw-fg);}
.nw-journal-mailtags{font-size:var(--nw-fs-tiny);color:var(--nw-fg-soft);}

/* ------------------------------------------------- R32 ① 投稿准备进度页 ---
   Step 3 opens here and stays here until the host answers. The five rows are
   the work the host actually does, so the wait reads as "it is doing the right
   things" instead of "it froze". */
.nw-prep{
  display:flex;flex-direction:column;align-items:center;gap:var(--nw-sp-3);
  padding:var(--nw-sp-5) var(--nw-sp-3) var(--nw-sp-4);
  border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-card);
  background:var(--nw-panel);
}
.nw-prep-head{display:flex;align-items:center;gap:10px;}
.nw-prep-orb{
  width:14px;height:14px;flex:0 0 auto;border-radius:50%;
  background:var(--nw-brand);
  box-shadow:0 0 0 0 color-mix(in srgb, var(--nw-brand) 55%, transparent);
  animation:nw-prep-pulse 1.5s var(--nw-ease) infinite;
}
@keyframes nw-prep-pulse{
  0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--nw-brand) 45%, transparent);}
  70%{box-shadow:0 0 0 12px color-mix(in srgb, var(--nw-brand) 0%, transparent);}
  100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--nw-brand) 0%, transparent);}
}
.nw-prep-title{font-size:var(--nw-fs-base);font-weight:600;color:var(--nw-fg);}
.nw-prep-steps{
  display:flex;flex-direction:column;gap:2px;width:100%;max-width:420px;
  margin:0;padding:0;list-style:none;
}
.nw-prep-step{
  display:flex;align-items:center;gap:9px;height:26px;
  font-size:var(--nw-fs-second);color:var(--nw-fg-soft);
  transition:color var(--nw-dur) var(--nw-ease),opacity var(--nw-dur) var(--nw-ease);
  opacity:.55;
}
.nw-prep-step[data-on="1"]{opacity:.9;color:var(--nw-fg);}
.nw-prep-step[data-now="1"]{opacity:1;color:var(--nw-brand);font-weight:600;}
.nw-prep-dot{
  width:6px;height:6px;flex:0 0 auto;border-radius:50%;
  background:currentColor;opacity:.45;
}
.nw-prep-step[data-on="1"] .nw-prep-dot{
  opacity:1;background:var(--nw-brand);
}
.nw-prep-step[data-now="1"] .nw-prep-dot{animation:nw-prep-blink 1s var(--nw-ease) infinite;}
@keyframes nw-prep-blink{0%,100%{opacity:1}50%{opacity:.25}}
.nw-prep-bar{
  position:relative;width:100%;max-width:420px;height:3px;overflow:hidden;
  border-radius:999px;background:color-mix(in srgb, var(--nw-fg) 9%, transparent);
}
.nw-prep-bar > i{
  position:absolute;top:0;left:0;height:100%;width:38%;
  border-radius:999px;background:var(--nw-brand);
  animation:nw-prep-sweep 1.6s var(--nw-ease) infinite;
}
@keyframes nw-prep-sweep{
  0%{transform:translateX(-100%);}
  100%{transform:translateX(320%);}
}
.nw-prep-hint{
  max-width:420px;text-align:center;
  font-size:var(--nw-fs-micro);line-height:1.65;color:var(--nw-fg-soft);
}
@media (prefers-reduced-motion: reduce){
  .nw-prep-orb{animation:none;box-shadow:none;}
  .nw-prep-bar > i{animation:none;width:100%;opacity:.4;}
  .nw-prep-step[data-now="1"] .nw-prep-dot{animation:none;}
}

/* ---------------------------------------------------------------- pairing -- */
/* R34 ③: the phone pairing dialog. The QR arrives as inline SVG from the host,
   so CSS only has to give it a quiet white plate — a code drawn on a tinted
   background loses the contrast scanners depend on. */
.nw-pair{display:flex;flex-direction:column;gap:var(--nw-sp-3);}
.nw-pair-box{
  display:flex;align-items:flex-start;gap:var(--nw-sp-4);
  padding:var(--nw-sp-3);border:1px solid var(--nw-line);border-radius:var(--nw-r-card);
  background:var(--nw-panel);
}
.nw-pair-code{
  flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  padding:8px;border-radius:var(--nw-r-control);
  background:#ffffff; /* deliberately literal: the quiet zone must be paper */
}
.nw-pair-code > svg{display:block;width:180px;height:180px;}
.nw-pair-meta{display:flex;flex-direction:column;gap:6px;min-width:0;}
.nw-pair-addr{font-size:var(--nw-fs-second);font-weight:600;color:var(--nw-fg);word-break:break-all;}
.nw-pair-timer{font-size:var(--nw-fs-micro);color:var(--nw-fg-soft);}
.nw-pair-empty{
  display:flex;align-items:center;justify-content:center;min-height:120px;
  border:1px dashed var(--nw-line-strong);border-radius:var(--nw-r-card);
  font-size:var(--nw-fs-second);color:var(--nw-fg-soft);text-align:center;padding:var(--nw-sp-3);
}
.nw-pair-actions{display:flex;gap:var(--nw-sp-2);}
.nw-pair-peers{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;}
.nw-pair-peer{
  display:flex;align-items:center;gap:var(--nw-sp-2);
  padding:var(--nw-sp-2) var(--nw-sp-3);border:1px solid var(--nw-line-soft);
  border-radius:var(--nw-r-control);background:var(--nw-surface-1);
}
.nw-pair-peername{font-size:var(--nw-fs-second);font-weight:600;color:var(--nw-fg);}
.nw-pair-peer .nw-hint-block{margin-left:auto;margin-bottom:0;}

/* R34: model picker shown when every configured model failed. The tried list is
   the useful half — it turns 「打不开」 into 「这三个都不通，各自的原因如下」. */
.nw-picker-tried{
  display:flex;flex-direction:column;gap:4px;
  margin:0 0 var(--nw-sp-3);padding:var(--nw-sp-2) var(--nw-sp-3);
  border:1px solid var(--nw-line-soft);border-radius:var(--nw-r-control);
  background:var(--nw-sunken);list-style:none;
}
.nw-picker-tried > li{display:flex;gap:var(--nw-sp-2);align-items:baseline;font-size:var(--nw-fs-micro);line-height:1.6;}
.nw-picker-triedname{flex:0 0 auto;color:var(--nw-fg);font-weight:600;}
.nw-picker-triedmsg{flex:1 1 auto;min-width:0;color:var(--nw-fg-soft);overflow-wrap:anywhere;}
@media (max-width:520px){
  .nw-pair-box{flex-direction:column;align-items:center;}
  .nw-pair-code > svg{width:150px;height:150px;}
}
`);
})();