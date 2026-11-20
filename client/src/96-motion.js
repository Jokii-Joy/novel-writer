;(() => {
  'use strict';

  // ===========================================================================
  // 96-motion.js — the motion layer.
  //
  // One easing curve and one duration for the whole plugin, plus the four
  // entrances the design language calls for: a dialog rises (nw-fade-up), a
  // toast arrives (nw-toast-in), a panel slides in (nw-slide) and a floating
  // menu pops (nw-pop). The two tokens defined here are read by every other
  // part — 60-editor and 90-app already ask for them with a fallback, so this
  // file is the place they finally resolve.
  //
  // Everything below is decoration over a layout that already works without it
  // and is switched off wholesale under prefers-reduced-motion.
  // ===========================================================================
  NW.CSS_PARTS.push(`
/* ---------------------------------------------------------------- timing -- */
.nw-root{
  --nw-ease:cubic-bezier(.2,.7,.2,1);
  --nw-ease-pop:cubic-bezier(.22,1.16,.36,1);
  --nw-dur:.18s;
  --nw-dur-long:.28s;
  /* R135: only the palette cross-fade uses this, so the half-hourly automatic
     swap can dissolve without slowing every hover on the page with it. */
  --nw-dur-theme:var(--nw-dur);
}

/* R135: 自动轮换是「换一屋子的光」，不是换皮。应用在换主题前后约 1.4 秒里挂上
   data-theme-slow="1"，纸、底色、墨色一起慢慢走；手动点主题不走这条路，仍然
   180ms。减弱动效时 05-css.js 的 !important 会把它压回快切，这是想要的行为。 */
.nw-root[data-theme-slow="1"]{
  --nw-dur-theme:1.2s;
}

@keyframes nw-fade-up{
  from{opacity:0;transform:translateY(6px);}
  to{opacity:1;transform:none;}
}
@keyframes nw-fade-in{
  from{opacity:0;}
  to{opacity:1;}
}
@keyframes nw-toast-in{
  from{opacity:0;transform:translateY(10px) scale(.96);}
  to{opacity:1;transform:none;}
}
@keyframes nw-slide{
  from{opacity:0;transform:translateX(-12px);}
  to{opacity:1;transform:none;}
}
@keyframes nw-pop{
  from{opacity:0;transform:translateY(8px) scale(.94);}
  to{opacity:1;transform:none;}
}

/* --------------------------------------------------------------- helpers --
   Utility classes so a component can opt into an entrance without owning a
   keyframe. 50-shelf renders its row menu with .nw-fade-up. */
.nw-fade-up{animation:nw-fade-up var(--nw-dur,.18s) var(--nw-ease,ease) both;}
.nw-fade-in{animation:nw-fade-in var(--nw-dur,.18s) var(--nw-ease,ease) both;}
.nw-slide-in{animation:nw-slide var(--nw-dur,.18s) var(--nw-ease,ease) both;}
.nw-pop-in{animation:nw-pop var(--nw-dur,.18s) var(--nw-ease-pop,ease) both;}

/* ---------------------------------------------------------- interactions --
   One transition vocabulary for controls that do not declare their own. The
   :where() keeps specificity at zero so any component rule still wins. */
.nw-root :where(.nw-btn,.nw-input,.nw-select,.nw-textarea,.nw-rowitem,.nw-suggest,
  .nw-journal-item,.nw-choice,.nw-fold > summary,.nw-toast,.nw-dock-btn,.nw-dock-fab){
  transition:background-color var(--nw-dur,.18s) var(--nw-ease,ease),
    border-color var(--nw-dur,.18s) var(--nw-ease,ease),
    color var(--nw-dur,.18s) var(--nw-ease,ease),
    box-shadow var(--nw-dur,.18s) var(--nw-ease,ease),
    transform var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-root :where(.nw-journal-item,.nw-choice):active{transform:translateY(1px);}

/* ------------------------------------------------------- reduced motion --- */
@media (prefers-reduced-motion: reduce){
  .nw-root *,.nw-root *::before,.nw-root *::after{
    animation-duration:.001ms !important;
    animation-iteration-count:1 !important;
    transition-duration:.001ms !important;
    scroll-behavior:auto !important;
  }
  .nw-btn:hover:not(:disabled),
  .nw-dock-btn:hover,.nw-journal-item:hover,
  .nw-choice:hover{transform:none !important;}
}
`);
})();
