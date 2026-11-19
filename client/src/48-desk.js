;(() => {
  'use strict';

  // ============================================================================
  // 精神空间 · 桌面 (R164)
  //
  // Two things live here, and both exist because the writing surface stopped
  // being a grey rectangle:
  //
  // 1. THE SHEET. The paper is painted on `.nw-scroll` — the element that does
  //    not move — instead of on `.nw-page`, which is as tall as the manuscript
  //    and therefore dragged its own edges up the panel as you wrote. On a real
  //    desk the paper stays put and the words advance; that is the whole point
  //    of writing on paper, so the paint had to move to the stationary box.
  //    `.nw-page` keeps its padding (the margin of the page) and loses its fill.
  //
  // 2. THE PILE. Finished pages lie at the left of the sheet, stacked newest on
  //    top, each one carrying the real words of that page (60-editor.js slices
  //    them out of the manuscript — nothing here is sample text). The pile is
  //    the only honest way to show progress in a page-shaped editor: you can
  //    count them, read them, and click one to take it back onto the desk.
  //
  // The rule that keeps this from looking like a skin: every number in the pile
  // comes from a measurement of the actual text, and the pile only ever holds
  // pages that have completely left the top of the sheet.
  // ============================================================================

  NW.CSS_PARTS.push(`
/* ================================================================ 桌面 ==== */

/* ---- the sheet ----------------------------------------------------------- */
/* Only in 窗外 mode: with the scene off the surface keeps its old flat look, so
   an existing writer's page does not silently change shape under them. */
.nw-surface[data-scene="1"] .nw-scroll{
  width:min(var(--nw-width,760px),calc(100% - 104px));
  /* The bottom margin is the desk: the scene draws a slate surface under the
     paper's front edge, and without a strip of it the sheet reads as floating
     in the weather instead of lying on something. The top margin is the glass:
     a sheet pushed right up against the top edge hides the window it is
     supposed to be sitting in front of. */
  margin:40px auto 112px;
  /* A sheet of paper, not a card: warm fill, one hairline at the edge, and two
     shadows — a tight contact shadow that keeps it on the desk and a long soft
     one that puts air under it. The window light is a second, very soft layer
     that only touches the top of the sheet, so the text never loses contrast.
     The two multiply layers are the paper itself: a 140px fibre grain you can
     see in the margins, and a 420px mottle that keeps the sheet from being one
     flat colour. Both are alpha-thin — legibility of 20px type comes first. */
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='.86' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='140' height='140' filter='url(%23p)' opacity='.16'/></svg>"),
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'><filter id='m'><feTurbulence type='fractalNoise' baseFrequency='.011' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='420' height='420' filter='url(%23m)' opacity='.13'/></svg>"),
    linear-gradient(0deg, rgba(122,98,66,.13) 0, rgba(122,98,66,.05) 1.6%, rgba(122,98,66,0) 4.2%),
    radial-gradient(130% 46% at 50% -6%, rgba(255,247,226,.55) 0%, rgba(255,247,226,0) 62%),
    linear-gradient(179deg, #fffdf7 0%, #fdfaf1 38%, #faf4e6 78%, #f6eedd 100%);
  background-size:140px 140px, 420px 420px, 100% 100%, auto, auto;
  background-blend-mode:multiply, multiply, normal, normal, normal;
  border-radius:2px;
  box-shadow:
    0 0 0 1px rgba(118,98,68,.17),
    0 1px 0 0 rgba(255,255,255,.9) inset,
    0 -1px 0 0 rgba(255,255,255,.62) inset,
    -1px 0 0 0 rgba(255,255,255,.5) inset,
    0 0 42px rgba(126,102,66,.07) inset,
    0 1px 0 0 rgba(150,126,92,.20),
    0 2px 0 -1px rgba(126,104,72,.16),
    1px 0 0 0 rgba(255,255,255,.55),
    2px 0 0 -1px rgba(96,78,52,.22),
    0 2px 0 0 rgba(255,255,255,.5),
    3px 0 0 -1px rgba(96,78,52,.14),
    10px 4px 22px -14px rgba(2,6,8,.75),
    0 2px 6px -2px rgba(8,12,14,.5),
    0 22px 40px -22px rgba(6,10,12,.72),
    0 64px 84px -62px rgba(0,0,0,.86);
  /* The words run out at the sheet's edge the way a page being written does;
     these two inner shadows are what stop that edge from looking like a crop. */
  scrollbar-width:none;
  scrollbar-gutter:auto;
}
.nw-surface[data-scene="1"] .nw-scroll::-webkit-scrollbar{width:0;height:0;}
.nw-surface[data-scene="1"] .nw-scroll::before,
.nw-surface[data-scene="1"] .nw-scroll::after{
  content:'';position:sticky;left:0;right:0;display:block;height:22px;
  pointer-events:none;z-index:6;
}
.nw-surface[data-scene="1"] .nw-scroll::before{
  top:0;margin-bottom:-22px;
  background:linear-gradient(180deg, rgba(253,249,240,.92), rgba(253,249,240,0));
}
.nw-surface[data-scene="1"] .nw-scroll::after{
  bottom:0;margin-top:-22px;
  background:linear-gradient(0deg, rgba(250,244,230,.92), rgba(250,244,230,0));
}
.nw-surface[data-scene="1"] .nw-page{
  background:none;
  border:0;
  border-radius:0;
  box-shadow:none;
}
/* One settle per finished page: a half-second breathe so the eye connects the
   word that just left the top of the sheet with the sheet that arrives in the
   pile. Transform/opacity only — no layout, no repaint of the text. */
@keyframes nw-sheet-settle{
  0%   {--nw-settle:0;}
  38%  {--nw-settle:1;}
  100% {--nw-settle:0;}
}
.nw-surface[data-scene="1"] .nw-scroll.is-settle{
  animation:nw-sheet-settle .52s cubic-bezier(.25,.8,.3,1) 1;
}
.nw-surface[data-scene="1"] .nw-scroll.is-settle.is-back{
  animation-duration:.38s;
}

/* ---- the pile ------------------------------------------------------------ */
.nw-pile{
  position:absolute;bottom:34px;z-index:3;
  left:calc(50% - min(var(--nw-width,760px),calc(100% - 104px)) / 2 - 172px);
  width:160px;height:224px;
  perspective:900px;
  font-family:var(--nw-reading-font);
}
.nw-card{
  position:absolute;left:0;bottom:calc(var(--i, 0) * 7px);
  width:152px;height:204px;
  padding:11px 12px 15px;box-sizing:border-box;
  overflow:hidden;text-align:left;
  border:0;border-radius:1px;appearance:none;
  background-image:linear-gradient(176deg,#fffdf6 0%,#fbf5e7 58%,#f4ead6 100%);
  box-shadow:
    0 0 0 1px rgba(96,80,54,.22),
    0 1px 0 0 rgba(255,255,255,.9) inset,
    0 2px 3px -1px rgba(0,0,0,.34),
    0 14px 22px -12px rgba(0,0,0,.58);
  transform-origin:50% 100%;
  transform:translateY(0) rotate(calc(var(--i, 0) * -0.7deg));
  transition:transform .26s cubic-bezier(.2,.7,.2,1), box-shadow .26s ease;
  cursor:pointer;
  z-index:calc(20 - var(--i, 0));
}
.nw-card:hover,
.nw-card:focus-visible{
  transform:translateY(-10px) rotate(0deg) scale(1.9);
  box-shadow:
    0 0 0 1px rgba(120,100,70,.16),
    0 1px 0 0 rgba(255,255,255,.9) inset,
    0 26px 40px -22px rgba(0,0,0,.6);
  z-index:40;
  outline:none;
}
.nw-card:focus-visible{box-shadow:0 0 0 2px var(--nw-find-ring), 0 26px 40px -22px rgba(0,0,0,.6);}
.nw-card-head{
  font-size:8px;line-height:1.3;letter-spacing:.16em;text-transform:none;
  color:rgba(122,92,58,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  margin-bottom:6px;
}
.nw-card-body{
  font-size:7.6px;line-height:1.82;letter-spacing:.01em;text-indent:2em;
  color:rgba(52,47,40,.62);
  word-break:break-all;
  -webkit-mask-image:linear-gradient(180deg,#000 0,#000 74%,rgba(0,0,0,.05) 100%);
  mask-image:linear-gradient(180deg,#000 0,#000 74%,rgba(0,0,0,.05) 100%);
}
.nw-card-foot{
  position:absolute;left:0;right:0;bottom:6px;text-align:center;
  font-size:7.5px;letter-spacing:.14em;color:rgba(122,92,58,.72);
  font-variant-numeric:tabular-nums;
}
/* the sheet that has just been added lifts in from the top-right, the sheet
   that came back slides under the pile — both are the same card, so the two
   directions read as one object moving, not as a list re-rendering */
@keyframes nw-card-in{
  from{opacity:0;transform:translate(14px,-16px) rotate(-3.4deg) scale(.96);}
  to{opacity:1;}
}
.nw-card[data-fresh="1"]{animation:nw-card-in .42s cubic-bezier(.2,.8,.25,1) 1;}
.nw-pile-count{
  position:absolute;left:0;bottom:-20px;width:152px;text-align:center;
  font-size:9.5px;letter-spacing:.16em;color:rgba(236,240,240,.62);
  text-shadow:0 1px 2px rgba(0,0,0,.35);
  font-variant-numeric:tabular-nums;
}
@container nw (max-width: 1060px){
  .nw-pile{display:none;}
}
`);
})();
