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
 * Tiers (deliberately three, not seven):
 *   <= 980  full shell still fine, chrome gets tighter
 *   <= 780  two-column grids collapse, shelf starts overlaying
 *   <= 560  single column everywhere, shelf and advice become overlays
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
  .nw-dock{right:14px;bottom:52px;}
  .nw-status{gap:var(--nw-sp-3);}
}

/* ------------------------------------------------------------ <= 780px -- */
@container nw (max-width: 780px){
  /* The modal is the one surface that must never be narrower than its content:
     a 680px settings dialog inside a 700px panel leaves 10px of scrim. */
  .nw-modal{max-width:100% !important;border-radius:var(--nw-r-card);}
  .nw-modal-mask{padding:14px;}
  .nw-modal-head{padding:15px 16px 13px;}
  .nw-modal-body{padding:16px;}
  .nw-modal-foot{padding:12px 16px;flex-wrap:wrap;}

  /* Settings: the sticky left rail becomes a horizontal scroller on top. */
  .nw-settings{grid-template-columns:minmax(0,1fr);gap:var(--nw-sp-2);}
  .nw-settings-nav{
    position:static;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;
    gap:6px;padding-bottom:6px;border-bottom:1px solid var(--nw-line-soft);
  }
  .nw-settings-navbtn{width:auto;flex:0 0 auto;padding:0 12px;}
  .nw-settings-pane{max-height:none;overflow:visible;}

  .nw-welcome-grid{grid-template-columns:minmax(0,1fr);}
  .nw-welcome-stats,.nw-welcome-quick{grid-template-columns:minmax(0,1fr);}

  /* The shelf width is a user preference (drag, up to 640px) written inline, so
     a CSS cap is the only way to stop it starving the manuscript in a narrow
     panel. The splitter still works — it just cannot exceed the cap. */
  .nw-side{max-width:min(62%,300px);}

  /* Tools: the dock shrinks to its FAB, the advice column narrows. The width is
     an inline style (the user may have dragged it), so !important is the only
     way a container tier can cap it. */
  .nw-dock-btn{height:34px;padding:0 12px;font-size:13px;}
  .nw-suggest{width:min(280px,40%) !important;}
  .nw-suggest-body{padding:0 var(--nw-sp-2) var(--nw-sp-2);}
}

/* ------------------------------------------------------------ <= 560px -- */
@container nw (max-width: 560px){
  /* Below this the two-pane shell (shelf + paper) cannot both be readable, so
     the shelf lifts out of the flow and floats over the paper, and the splitter
     goes away because there is nothing left to drag. The width still comes from
     the inline style (the user may have set 300px); it is simply no longer
     taking room from the manuscript. */
  .nw-side{
    position:absolute;left:0;top:0;bottom:0;z-index:34;
    max-width:min(88%,320px);
    box-shadow:0 2px 8px rgba(0,0,0,.08), 0 18px 44px rgba(0,0,0,.18);
  }
  .nw-splitter{display:none !important;}

  /* The advice panel does the same: overlay, anchored right. */
  .nw-suggest{
    position:absolute;right:0;top:0;bottom:0;z-index:33;
    width:min(92%,360px) !important;max-width:92% !important;
    box-shadow:0 2px 8px rgba(0,0,0,.08), 0 18px 44px rgba(0,0,0,.18);
  }

  /* Reading measure: 48px of gutter on a 520px panel eats a fifth of the line.
     The dock lane is kept at 88px total (20 + 68) — the floating dock is still
     there at this width, just closer to the edge. */
  .nw-surface{--nw-pad-x:20px;--nw-pad-y:32px;--nw-gutter-x:68px;}

  .nw-notes{left:8px;right:8px;top:48px;max-width:none;}
  .nw-notes-card{width:100%;max-height:min(280px,calc(100vh - 200px));}

  /* Below the shelf overlay (34) and the advice overlay (33): when the shelf is
     lifted out of the flow it must be able to cover the dock, otherwise its
     bottom buttons are unreachable on a phone-sized panel. */
  .nw-dock{right:10px;bottom:46px;z-index:30;}
  .nw-dock-fab{width:40px;height:40px;}
  .nw-notes-tabtxt{display:none;}

  .nw-status{padding:0 var(--nw-sp-2);font-size:12px;flex-wrap:wrap;row-gap:2px;height:auto;min-height:var(--nw-h-status);}
  .nw-status .nw-status-mid{gap:8px !important;}
}

/* Touch and coarse pointers: no hover, so anything hidden behind :hover has to
   be visible on its own. */
@media (hover: none){
  .nw-row-actions{opacity:1;}
  .nw-notes-tab{opacity:.85;}
  .nw-homebtn{opacity:.85;}
  .nw-dock{opacity:.85;}
}
`);
})();
