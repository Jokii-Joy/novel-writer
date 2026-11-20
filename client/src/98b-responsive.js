/* ==== 98b-responsive.js ====
 *
 * R13 ① — the plugin is a column inside the host shell, not a page.
 *
 * Before this file every breakpoint was a viewport one (@media), so on a
 * 1400px window the plugin could still be squeezed into a 520px panel by the
 * host sidebar and the fourty-some grids inside it had no idea. The measurement
 * that actually matters is the width of .nw-root, so 05-css declares it a
 * named container ("nw") and everything below sizes itself in cqw.
 *
 * Tiers (two, not seven — the desktop panel is the only target now):
 *   <= 980  full shell still fine, chrome gets tighter
 *   <= 780  two-column grids collapse, shelf starts overlaying
 *
 * The @media blocks in 97-theme.js are kept as a fallback for engines without
 * container queries; these rules come later in source order and win ties.
 */
;(() => {
  'use strict';

  NW.CSS_PARTS.push(`
/* ------------------------------------------------------------ <= 980px -- */
@container nw (max-width: 980px){
  .nw-grid2{grid-template-columns:minmax(0,1fr);}
  .nw-settings{grid-template-columns:132px minmax(0,1fr);gap:var(--nw-sp-3);}
  .nw-submit-grid{grid-template-columns:minmax(0,1fr);min-height:0;gap:var(--nw-sp-3);}
  .nw-journal-list{max-height:280px;}
  .nw-dock{right:14px;bottom:52px;--nw-dock-tile:24px;--nw-dock-gap:10px;}
  .nw-status{gap:var(--nw-sp-3);}
}

/* ------------------------------------------------------------- bench < 940 -- */
/* R28 ① / R30: the card sizes itself from the gutter the centred page leaves on
   its left — that gutter is (bench - page) / 2, so it shrinks as the column gets
   narrower. R28 used to answer that by switching to a fixed 260px floating card
   at this tier, which is precisely what covered the first characters of every
   line. The rule is now only about density: a narrow card gets tighter padding
   and slightly smaller type, and its width keeps tracking the gutter. */
@container bench (max-width: 940px){
  /* R30: this used to force a 260px floating card, which promptly covered the
     first characters of every line — exactly the complaint that the card must
     not sit on the text. The width formula in 90-app.js already shrinks with
     the gutter, so nothing needs to override it here: a narrow column simply
     gets a narrow card that still hugs the page. */
  .nw-notes-card{padding:var(--nw-sp-1);}
  .nw-notes-input{padding:10px 11px;font-size:14px;}
}

/* ------------------------------------------------------------ <= 780px -- */
@container nw (max-width: 780px){
  /* The modal is the one surface that must never be narrower than its content:
     a 680px settings dialog inside a 700px panel leaves 10px of scrim. */
  .nw-modal{max-width:100% !important;border-radius:var(--nw-r-card);}
  .nw-modal-mask{padding:var(--nw-sp-4);}
  .nw-modal-head{padding:15px 16px 13px;}
  .nw-modal-body{padding:var(--nw-sp-4);}
  .nw-modal-foot{padding:12px 16px;flex-wrap:wrap;}

  /* Settings: the sticky left rail becomes a horizontal scroller on top. */
  .nw-settings{grid-template-columns:minmax(0,1fr);gap:var(--nw-sp-2);}
  .nw-settings-nav{
    position:static;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;
    gap:var(--nw-sp-0);padding-bottom:var(--nw-sp-0);border-bottom:1px solid var(--nw-line-soft);
  }
  .nw-settings-navbtn{width:auto;flex:0 0 auto;padding:0 12px;}
  .nw-settings-pane{max-height:none;overflow:visible;}

  .nw-welcome-grid{grid-template-columns:minmax(0,1fr);}
  .nw-welcome-stats,.nw-welcome-quick{grid-template-columns:minmax(0,1fr);}

  /* The shelf width is a user preference (drag, up to 640px) written inline, so
     a CSS cap is the only way to stop it starving the manuscript in a narrow
     panel. The splitter still works — it just cannot exceed the cap. */
  .nw-side{max-width:min(62%,300px);}

  /* Tools: the dock shrinks to its FAB, the advice column narrows. R25: the
     column is auto-width now, so this tier only has to cap it — and it caps both
     the auto width and a dragged inline width. */
  .nw-dock{--nw-dock-tile:22px;--nw-dock-gap:9px;}
  .nw-dock-btn{height:36px;padding:0 12px 0 10px;font-size:var(--nw-fs-micro);}
  .nw-suggest{width:min(320px,42%) !important;max-width:42% !important;}
  .nw-suggest-body{padding:0 var(--nw-sp-2) var(--nw-sp-2);}
}

`);
})();
