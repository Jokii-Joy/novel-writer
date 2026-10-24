;(() => {
  'use strict';

  // ===========================================================================
  // 97-theme.js — the final polish pass. Loaded after every other styling part
  // (96-motion is just before it), so it can both (a) raise any size an older
  // part still ships at 10.5–14px up to the project scale, and (b) stamp the
  // shared visual signature on top: layered paper, hairlines, a hover micro-lift,
  // one focus ring, the 3px brand accent rule, serif display type, the drawn
  // empty-state medallion and the dimmed floating dock.
  //
  // Everything here is an override. No class names are invented for markup the
  // element tree does not have; selectors target only what other parts render.
  // Colours come exclusively from the --nw-* tokens published by 05-css.js,
  // which in turn map to the host's --dsw-alias-* tokens or to the per-theme
  // remap in 98-shell-theme.js. The listed exceptions are neutral black alphas
  // (shadows, scrim) that have no token peer.
  //
  // Scale (project baseline, restated so this file can be audited):
  //   type    16 base · 14 secondary · 13 micro · 17–19 panel title
  //   radius  12 card · 10 control · 16 modal · 999 pill
  //   metric  36 button · 34 icon · 38 input · 52 toolbar · 34 status
  // ===========================================================================
  NW.CSS_PARTS.push(`
/* ================================================================ buttons == */
.nw-btn{
  height:var(--nw-h-btn);padding:0 16px;border-radius:var(--nw-r-control);
  font-size:var(--nw-fs-base);font-weight:500;line-height:1;gap:var(--nw-sp-1);letter-spacing:.01em;
  transition:background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-btn:hover:not(:disabled){
  background:var(--nw-surface-2);border-color:var(--nw-line);
  transform:translateY(-1px);box-shadow:var(--nw-shadow-1);
}
.nw-btn:active:not(:disabled){transform:translateY(0);box-shadow:none;}
.nw-btn:disabled{opacity:.42;}
.nw-btn:focus-visible{
  outline:2px solid var(--nw-brand);outline-offset:2px;
  box-shadow:var(--nw-ring-soft);
}
/* The primary button is the only saturated surface in the shell. In the light
   palettes the brand is near-black ink, so the label is the paper colour —
   color:var(--nw-bg) is exactly the contrast 40-ui's hard-coded #fff was
   standing in for, and it stays correct when the brand turns light at night. */
.nw-btn[data-kind="primary"]{
  color:var(--nw-bg);border-color:transparent;font-weight:600;
  background:var(--nw-brand);
  box-shadow:0 1px 2px color-mix(in srgb, var(--nw-brand) 26%, transparent);
}
.nw-btn[data-kind="primary"]:hover:not(:disabled){
  background:color-mix(in srgb, var(--nw-bg) 10%, var(--nw-brand));
  border-color:transparent;color:var(--nw-bg);filter:none;
  box-shadow:0 6px 18px color-mix(in srgb, var(--nw-brand) 26%, transparent);
}
.nw-btn[data-kind="primary"]:active:not(:disabled){
  background:color-mix(in srgb, var(--nw-bg) 4%, var(--nw-brand));
}
.nw-btn[data-kind="danger"]{
  color:var(--nw-danger);
  border-color:color-mix(in srgb, var(--nw-danger) 28%, var(--nw-line));
}
/* R19 C1: only buttons had a pressed state. Every clickable row in the plugin
   (shelf rows, journal items, welcome cards, advice cards) now answers the
   finger too — one shared rule, because they all already carry a data-active or
   aria-selected attribute for the selected state. */
.nw-root :where(.nw-shelf-row,.nw-shelf-novel,.nw-journal-item,.nw-welcome-novel,
  .nw-welcome-quickbtn,.nw-welcome-subbtn,.nw-advice,.nw-rowitem,.nw-choice,
  .nw-settings-navbtn,.nw-advice-chip):active{
  transform:translateY(1px);
}
.nw-root :where(.nw-advice-chip,.nw-welcome-quickbtn,.nw-journal-item,.nw-settings-navbtn){
  transition:background var(--nw-dur) var(--nw-ease,ease),
    border-color var(--nw-dur) var(--nw-ease,ease),
    transform 90ms var(--nw-ease,ease);
}
.nw-btn[data-kind="danger"]:hover:not(:disabled){
  background:color-mix(in srgb, var(--nw-danger) 10%, transparent);
  border-color:color-mix(in srgb, var(--nw-danger) 46%, transparent);
  color:var(--nw-danger);
}
.nw-btn[data-kind="ghost"]{border-color:transparent;color:var(--nw-fg-soft);}
.nw-btn[data-kind="ghost"]:hover:not(:disabled){
  background:var(--nw-surface-2);border-color:transparent;color:var(--nw-fg);
}
/* In the tool strip these are the only actions on screen: they carry the ink at
   rest instead of reading as disabled secondary text. */
.nw-toolbar .nw-btn[data-kind="ghost"]{color:color-mix(in srgb, var(--nw-fg) 84%, transparent);}
.nw-toolbar .nw-btn[data-kind="ghost"]:hover:not(:disabled){color:var(--nw-fg);}
.nw-btn[data-kind="icon"]{
  width:var(--nw-h-iconbtn);height:var(--nw-h-iconbtn);padding:0;
  border-radius:var(--nw-r-control);color:var(--nw-fg-soft);
}
.nw-btn[data-kind="icon"]:hover:not(:disabled){
  background:var(--nw-surface-2);border-color:transparent;color:var(--nw-fg);
}
/* R17 ③: the glyph span only ever carries a text fallback (emoji/letter) — real
   icons are <svg> from 42-icons, which owns its own size on the shared ladder.
   A blanket font-size here used to inflate the text fallbacks far past the
   icons next to them. */
.nw-btn[data-kind="icon"] > span{font-size:15px !important;line-height:1 !important;}
.nw-btn[data-active="1"]{
  background:color-mix(in srgb, var(--nw-brand) 9%, var(--nw-surface-1));
  border-color:color-mix(in srgb, var(--nw-brand) 28%, var(--nw-line));
  color:var(--nw-brand);font-weight:600;box-shadow:none;
}
.nw-toolbar .nw-btn[data-active="1"]{
  box-shadow:inset 0 -2px 0 color-mix(in srgb, var(--nw-brand) 78%, transparent);
}
/* compact tier: segmented controls, row actions and dialog footers stay one
   step below the primary size so a form does not turn into a wall of buttons */
.nw-seg > .nw-btn,.nw-genre-seg > .nw-btn,
.nw-suggest-actions .nw-btn,.nw-row-actions .nw-btn{
  height:32px;padding:0 13px;font-size:var(--nw-fs-second);
}
.nw-seg > .nw-btn:hover:not(:disabled),.nw-genre-seg > .nw-btn:hover:not(:disabled),
.nw-suggest-actions .nw-btn:hover:not(:disabled){
  transform:none;box-shadow:none;
}

/* ============================================================ text inputs == */
.nw-input,.nw-select,.nw-textarea{
  min-height:var(--nw-h-input);padding:0 13px;border-radius:var(--nw-r-control);
  border-color:var(--nw-line);background:var(--nw-surface-overlay);
  color:var(--nw-fg);font-size:var(--nw-fs-base);line-height:var(--nw-lh-base);
  box-shadow:none;
  transition:border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-select{height:var(--nw-h-input);padding-right:var(--nw-sp-2);}
.nw-textarea{height:auto;min-height:104px;padding:11px 13px;line-height:1.7;resize:vertical;}
.nw-input:hover:not(:disabled),.nw-select:hover:not(:disabled),.nw-textarea:hover:not(:disabled){
  border-color:var(--nw-line-strong);
}
.nw-input:focus,.nw-select:focus,.nw-textarea:focus{
  border-color:var(--nw-brand);outline:none;
  box-shadow:var(--nw-ring-soft);
}
.nw-input::placeholder,.nw-textarea::placeholder{color:var(--nw-fg-soft);opacity:.66;}
.nw-input[type="range"]{
  height:26px;min-height:26px;padding:0;border:0;background:transparent;
  box-shadow:none;accent-color:var(--nw-brand);
  -webkit-appearance:none;appearance:none;cursor:pointer;
}
/* Sliders live in the settings panel, so they get the same ink-on-paper
   treatment as every other control instead of the platform's blue-grey track.
   dialog3's rangeInput() builds input.nw-input.nw-range because NW.ui.input
   drops min/max/step, so both spellings are covered. */
.nw-input[type="range"],.nw-range{
  height:26px;min-height:26px;padding:0;border:0;background:transparent;
  box-shadow:none;accent-color:var(--nw-brand);
  -webkit-appearance:none;appearance:none;cursor:pointer;
}
.nw-input[type="range"]::-webkit-slider-runnable-track,
.nw-range::-webkit-slider-runnable-track{
  height:4px;border-radius:var(--nw-r-hair);background:var(--nw-surface-2);
  box-shadow:inset 0 0 0 1px var(--nw-line);
}
.nw-input[type="range"]::-webkit-slider-thumb,
.nw-range::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;
  border-radius:50%;background:var(--nw-brand);
  box-shadow:0 0 0 2px var(--nw-bg),0 0 0 3px var(--nw-line),var(--nw-shadow-1);
  transition:box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-input[type="range"]:hover::-webkit-slider-thumb,
.nw-range:hover::-webkit-slider-thumb{
  box-shadow:0 0 0 2px var(--nw-bg),
    0 0 0 5px color-mix(in srgb, var(--nw-brand) 26%, transparent),
    var(--nw-shadow-1);
}
.nw-input[type="range"]::-moz-range-track,
.nw-range::-moz-range-track{
  height:4px;border-radius:var(--nw-r-hair);background:var(--nw-surface-2);
}
.nw-input[type="range"]::-moz-range-thumb,
.nw-range::-moz-range-thumb{
  width:16px;height:16px;border:0;border-radius:50%;background:var(--nw-brand);
  box-shadow:0 0 0 2px var(--nw-bg),0 0 0 3px var(--nw-line);
}
.nw-input[type="range"]:focus,.nw-range:focus{box-shadow:none;}
.nw-input[type="range"]:focus-visible,.nw-range:focus-visible{
  outline:2px solid var(--nw-brand);outline-offset:4px;border-radius:var(--nw-r-hair);
}
.nw-field{gap:var(--nw-sp-1);margin-bottom:var(--nw-sp-4);}
.nw-field > label{
  font-size:var(--nw-fs-micro);font-weight:500;color:var(--nw-fg-soft);letter-spacing:.01em;
}
.nw-field .nw-hint{font-size:var(--nw-fs-micro);line-height:1.6;opacity:1;color:var(--nw-fg-soft);}

/* ================================================================== rows === */
.nw-row{padding:13px 0;border-bottom-color:var(--nw-line-soft);}
.nw-row > span:first-child{min-width:0;}
.nw-rowitem{
  font-size:var(--nw-fs-base);padding:9px 11px;border-radius:var(--nw-r-control);
  transition:background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-rowitem:hover{background:var(--nw-surface-2);}
.nw-rowitem[data-active="1"]{
  background:color-mix(in srgb, var(--nw-brand) 7%, var(--nw-surface-2));
  box-shadow:inset 3px 0 0 var(--nw-brand);
}
.nw-rowitem .nw-rowmeta{font-size:var(--nw-fs-micro);}

/* ================================================================ switch === */
.nw-switch{width:44px;height:24px;}
.nw-switch i{background:var(--nw-surface-2);box-shadow:inset 0 0 0 1px var(--nw-line-strong);}
.nw-switch i::after{
  top:2px;left:2px;width:20px;height:20px;background:var(--nw-bg);
  box-shadow:inset 0 0 0 1px var(--nw-line-strong),var(--nw-shadow-1);
  transition:transform var(--nw-dur,var(--nw-dur)) var(--nw-ease-pop,ease),background var(--nw-dur,var(--nw-dur)) ease;
}
.nw-switch input:checked + i{background:var(--nw-brand);box-shadow:none;}
.nw-switch input:checked + i::after{transform:translateX(20px);}

/* ================================================================= modal === */
.nw-modal-mask{
  padding:var(--nw-sp-6);background:rgba(0,0,0,.42);backdrop-filter:blur(3px);
  animation:nw-fade-in var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease) both;
}
.nw-modal{
  max-width:680px;position:relative;
  /* 40-ui paints the panel with bg-overlay, which is a grey slab in the dark
     theme and a blue-grey one in the light theme. A dialog is paper, not a
     scrim, so it is re-based on the ink-derived surface token. */
  background:var(--nw-surface-overlay);
  border-radius:var(--nw-r-modal);border:1px solid var(--nw-line-soft);
  box-shadow:var(--nw-shadow-3);
  animation:nw-fade-up var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease) both;
}
/* headband: the same brand hairline the lock card wears */
.nw-modal::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2px;z-index:var(--nw-z-base);pointer-events:none;
  background:linear-gradient(90deg,transparent,
    color-mix(in srgb, var(--nw-brand) 62%, transparent),transparent);
}
.nw-modal-head{padding:18px 22px 15px;border-bottom-color:var(--nw-line-soft);}
.nw-modal-head h2{
  font-family:var(--nw-reading-font);
  font-size:19px;font-weight:600;line-height:1.35;letter-spacing:.02em;color:var(--nw-fg);
}
.nw-modal-body{padding:20px 22px;font-size:var(--nw-fs-base);line-height:1.7;}
.nw-modal-body > p{margin:0 0 12px;font-size:var(--nw-fs-base) !important;line-height:1.7 !important;}
.nw-modal-body > p:last-child{margin-bottom:0;}
.nw-modal-body > p.nw-hint-block{font-size:var(--nw-fs-second) !important;color:var(--nw-fg-soft);}
.nw-modal-body > h3{
  margin:0 0 8px;font-family:var(--nw-reading-font);
  font-size:var(--nw-fs-title);font-weight:600;letter-spacing:.02em;color:var(--nw-fg);
}
.nw-modal-foot{
  padding:13px 22px;gap:var(--nw-sp-2);
  border-top-color:var(--nw-line-soft);background:var(--nw-surface-1);
}
.nw-modal-foot .nw-btn{min-width:88px;}
.nw-modal-foot .nw-spacer{flex:1 1 auto;}

/* ================================================================= toast === */
.nw-toast-wrap{bottom:60px;gap:var(--nw-sp-1);}
.nw-toast,
.nw-toast[data-kind="ok"],
.nw-toast[data-kind="error"],
.nw-toast[data-kind="info"],
.nw-toast[data-kind="default"]{
  display:inline-flex;align-items:center;gap:var(--nw-sp-2);
  padding:11px 18px;max-width:min(600px,74cqw);
  border-radius:var(--nw-r-pill);font-size:var(--nw-fs-second);font-weight:500;line-height:1.4;
  color:var(--nw-fg);background:var(--nw-surface-overlay);
  border:1px solid var(--nw-line);box-shadow:var(--nw-shadow-2);
  animation:nw-toast-in var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease) both;
}
.nw-toast::before{
  content:'';flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--nw-idle);
}
.nw-toast[data-kind="ok"]{border-color:color-mix(in srgb, var(--nw-ok) 34%, var(--nw-line));}
.nw-toast[data-kind="ok"]::before{background:var(--nw-ok);}
.nw-toast[data-kind="error"]{border-color:color-mix(in srgb, var(--nw-danger) 36%, var(--nw-line));}
.nw-toast[data-kind="error"]::before{background:var(--nw-danger);}
.nw-toast[data-kind="info"]::before{background:var(--nw-brand);}
/* R22: action toasts (撤销 on a delete) — the label is a real button, not
   decoration, so it gets its own hit area and the brand colour. */
.nw-toast-text{min-width:0;overflow-wrap:anywhere;}
.nw-toast-act{
  flex:0 0 auto;height:24px;padding:0 10px;margin-left:var(--nw-sp-0);
  border-radius:var(--nw-r-pill);border:1px solid var(--nw-line-strong);
  background:transparent;color:var(--nw-brand);
  font-family:inherit;font-size:var(--nw-fs-tiny);font-weight:600;cursor:pointer;
  transition:background var(--nw-dur) var(--nw-ease),color var(--nw-dur) var(--nw-ease);
}
.nw-toast-act:hover{background:var(--nw-brand);color:var(--nw-panel);}
.nw-toast-act:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}

/* ============================================================ empty state ===
   The generic NW.ui.empty() renders a folder glyph. Scale it into a medallion
   with a brand halo behind it, so a blank panel reads as a designed
   placeholder rather than a missing screen. The editor keeps its own .nw-empty
   treatment (with .nw-empty-glyph) from 60-editor.js; these selectors never
   reach it because the centre/modal hosts are required. */
.nw-center .nw-empty,.nw-modal-body .nw-empty{
  padding:8px 0 4px;gap:var(--nw-sp-4);
  /* 40-ui gives .nw-empty height:100% and 60-editor min-height:100%; inside a
     centred stage that would stretch the group to the full panel and strand the
     icon at the top. Both are reset so the block hugs its content. */
  height:auto;min-height:0;flex:0 0 auto;
  font-size:var(--nw-fs-base);line-height:1.7;color:var(--nw-fg-soft);
}
.nw-center > .nw-empty{padding:30px 0;}
.nw-center > p{font-size:var(--nw-fs-base);line-height:1.7;max-width:46ch;color:var(--nw-fg);}
.nw-center > .nw-btn,.nw-center .nw-empty > .nw-btn{
  height:40px;padding:0 22px;font-size:var(--nw-fs-base);
}
.nw-center .nw-empty > svg,.nw-modal-body .nw-empty > svg{
  width:64px;height:64px;padding:var(--nw-sp-4);border-radius:var(--nw-r-modal);opacity:1;
  color:var(--nw-brand);
  background:
    linear-gradient(160deg,
      color-mix(in srgb, var(--nw-brand) 13%, transparent),
      color-mix(in srgb, var(--nw-brand) 3%, transparent));
  border:1px solid color-mix(in srgb, var(--nw-brand) 20%, var(--nw-line-soft));
  /* the third shadow is the halo that makes the glyph read as a medallion;
     a pseudo-element cannot be used because svg does not render one */
  box-shadow:
    0 10px 28px color-mix(in srgb, var(--nw-brand) 10%, transparent),
    0 0 0 8px color-mix(in srgb, var(--nw-brand) 4%, transparent),
    0 0 48px 12px color-mix(in srgb, var(--nw-brand) 7%, transparent);
}
.nw-center .nw-empty > span{
  position:relative;max-width:34ch;
  font-family:var(--nw-reading-font);font-size:19px;letter-spacing:.02em;color:var(--nw-fg);
}
.nw-center .nw-empty::after{
  content:'';position:relative;width:36px;height:2px;border-radius:var(--nw-r-hair);
  background:linear-gradient(90deg,transparent,
    color-mix(in srgb, var(--nw-brand) 48%, transparent),transparent);
}
.nw-center .nw-inline{font-size:var(--nw-fs-base);gap:var(--nw-sp-2);color:var(--nw-fg-soft);}
.nw-center .nw-spin{width:20px;height:20px;border-width:2px;}

/* ================================================================ typography = */
/* The shell title and panel headings are set in the serif reading stack: it is
   the one typeface decision that makes the chrome read as a writing tool rather
   than a generic admin panel. Controls stay in the UI sans. */
.nw-title{font-family:var(--nw-reading-font);letter-spacing:.02em;}
.nw-title small{font-family:var(--nw-ui-font);letter-spacing:0;}

/* ================================================================ lock ===== */
.nw-lock-card{padding:38px 30px 28px;gap:var(--nw-sp-2);}
.nw-lock-title{font-family:var(--nw-reading-font);font-size:20px;letter-spacing:.02em;}
.nw-lock-hint{font-size:var(--nw-fs-second);line-height:1.75;}
.nw-lock-input{height:44px;font-size:var(--nw-fs-base);}
.nw-lock-actions{gap:var(--nw-sp-2);}
.nw-lock-actions > .nw-btn{flex:1 1 auto;height:38px;}
.nw-lock-card .nw-inline{justify-content:center;margin-top:var(--nw-sp-2);}

/* ============================================================== settings === */
.nw-settings-section{padding:16px 18px 8px;border-radius:var(--nw-r-card);}
.nw-settings-section > h3{font-size:var(--nw-fs-base);font-weight:600;letter-spacing:.02em;}
.nw-settings-section > h3::before{
  content:'';display:inline-block;width:3px;height:13px;border-radius:var(--nw-r-hair);
  background:var(--nw-brand);margin-right:var(--nw-sp-1);vertical-align:-2px;
}
.nw-settings-section .nw-row{padding:12px 0;}
.nw-seg{padding:3px;border-radius:var(--nw-r-control);}
.nw-grid2{gap:var(--nw-sp-3);}

/* =========================================================== suggestions === */
.nw-suggest > input[type="checkbox"]{
  width:17px;height:17px;margin-top:4px;accent-color:var(--nw-brand);
}
.nw-suggest-type{font-size:var(--nw-fs-micro);padding:2px 9px;}
.nw-suggest-reason{font-size:var(--nw-fs-micro);}
.nw-diff{font-size:var(--nw-fs-micro);}
.nw-version-list .nw-row{font-size:var(--nw-fs-base);padding:11px 0;}
.nw-preview-text{font-size:var(--nw-fs-micro);line-height:1.8;}
.nw-hint-block{font-size:var(--nw-fs-second);line-height:1.7;}
.nw-link{font-size:inherit;}
.nw-login-box{font-size:var(--nw-fs-second);}
.nw-kbd-row{font-size:var(--nw-fs-second);padding:7px 0;}
.nw-kbd-row kbd{font-size:var(--nw-fs-micro);}
.nw-journal-item{font-size:var(--nw-fs-second);padding:10px 12px;}
.nw-journal-detail{font-size:var(--nw-fs-second);}
.nw-badge{font-size:var(--nw-fs-micro);padding:2px 10px;}
.nw-submit-changes{font-size:var(--nw-fs-micro);}
.nw-signature{font-size:var(--nw-fs-second);}

/* ================================================================ status === */
.nw-status{font-size:var(--nw-fs-micro);gap:var(--nw-sp-4);}
.nw-status .nw-dot{width:8px;height:8px;}

/* ================================================================= dock ====
   90-app draws the dock; this layer only keeps it in the same material world as
   the paper: overlay surface, hairline, restrained shadow, and a hover that
   re-lifts. The dock must never compete with the text, hence the low resting
   opacity that 90-app already sets — nothing here raises it. */
.nw-dock{
  right:24px;bottom:64px;gap:var(--nw-sp-2);
  transition:opacity var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
/* R21: the FAB is the one control in the writing view that has to be findable
   without hovering, so it is the brand fill — same role as 新建小说 on the home
   screen. The earlier overlay fill sat within ~4% of the paper and vanished. */
.nw-dock-fab{
  width:46px;height:46px;border-radius:var(--nw-r-pill);
  border:1px solid color-mix(in srgb, var(--nw-brand) 82%, var(--nw-fg));
  background:var(--nw-brand);color:var(--nw-panel);
  box-shadow:var(--nw-shadow-2);
  font-size:19px;
  transition:transform var(--nw-dur,var(--nw-dur)) var(--nw-ease-pop,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-dock-fab:hover{
  transform:translateY(-2px);
  background:color-mix(in srgb, var(--nw-brand) 88%, var(--nw-fg));
  box-shadow:var(--nw-shadow-3);
}
.nw-dock-fab:active{transform:translateY(0) scale(.97);}
.nw-dock-fab:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-dock-menu{gap:var(--nw-sp-2);}
.nw-dock-menu[data-open="1"]{animation:nw-pop var(--nw-dur,var(--nw-dur)) var(--nw-ease-pop,ease) both;}
.nw-dock-btn{
  height:40px;padding:0 18px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line-soft);
  background:var(--nw-surface-overlay);color:var(--nw-fg);
  font-size:var(--nw-fs-second);font-weight:500;gap:var(--nw-sp-1);
  box-shadow:var(--nw-shadow-1);
  transition:transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    box-shadow var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
    background var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-dock-btn:hover:not(:disabled){
  transform:translateY(-1px);background:var(--nw-surface-overlay);
  border-color:var(--nw-line);box-shadow:var(--nw-shadow-2);
}
.nw-dock-btn:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
.nw-dock-btn > span[aria-hidden]{font-size:16px;line-height:1;color:var(--nw-fg-soft);}

/* ============================================================= immersive ===
   R3 removed the immersive top strip entirely: 90-app renders no Toolbar at all
   while immersive, and the only exit is Esc (announced by a toast). So there is
   nothing left to position — only the canvas itself and the dock, which stays
   reachable but recedes until hovered. */
.nw-root.nw-immersive{background:var(--nw-bg);}
.nw-root.nw-immersive .nw-dock{opacity:.22;}
.nw-root.nw-immersive .nw-dock:hover,
.nw-root.nw-immersive .nw-dock:focus-within{opacity:1;}

/* ============================================================== narrow ====
   The tool strip is the one place that must degrade: below ~980px of *panel*
   the breadcrumb suffix gives way so the actions keep their labels instead of
   the novel title being clipped to a single glyph.
   R13: this used to be an @media (max-width:900px) rule, i.e. window width. The
   toolbar lives inside the plugin's column, which can be 480px on a 1440px
   screen (host sidebar + rightbar), so the tier is measured against the
   container declared in 05-css. 98b-responsive.js refines the same tiers. */
@container nw (max-width: 980px){
  .nw-toolbar{padding:0 var(--nw-sp-3);gap:var(--nw-sp-0);}
  .nw-title{max-width:40%;padding-right:var(--nw-sp-1);}
  .nw-title small{display:none;}
  .nw-toolbar .nw-btn{padding:0 11px;}
  .nw-toolbar > span[style*="width: 1px"],
  .nw-toolbar > span[style*="width:1px"]{margin:0 2px;}
  .nw-status{gap:var(--nw-sp-3);padding:0 var(--nw-sp-3);}
  .nw-modal-mask{padding:var(--nw-sp-4);}
  .nw-modal{max-width:100%;border-radius:var(--nw-r-card);}
  .nw-modal-head{padding:15px 16px 13px;}
  .nw-modal-body{padding:var(--nw-sp-4);}
  .nw-modal-foot{padding:12px 16px;}
  .nw-dock{right:12px;bottom:52px;}
  .nw-dock-btn{height:38px;padding:0 15px;}
}
/* Belt and braces: engines without container queries still degrade on a narrow
   window instead of clipping. */
@supports not (container-type: inline-size){
  @media (max-width:900px){
    .nw-toolbar{padding:0 var(--nw-sp-3);gap:var(--nw-sp-0);}
    .nw-title{max-width:40%;padding-right:var(--nw-sp-1);}
    .nw-title small{display:none;}
    .nw-toolbar .nw-btn{padding:0 11px;}
    .nw-status{gap:var(--nw-sp-3);padding:0 var(--nw-sp-3);}
    .nw-dock{right:12px;bottom:52px;}
  }
}

/* ====================================================== motion preference == */
@media (prefers-reduced-motion: reduce){
  .nw-btn,.nw-btn:hover:not(:disabled),.nw-btn:active:not(:disabled),
  .nw-dock-fab,.nw-dock-fab:hover,.nw-dock-fab:active,
  .nw-dock-btn,.nw-dock-btn:hover:not(:disabled),
  .nw-journal-item,.nw-choice,.nw-theme-swatch{transform:none !important;}
  .nw-root *,.nw-root *::before,.nw-root *::after{
    animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important;scroll-behavior:auto !important;
  }
}
`);
})();
