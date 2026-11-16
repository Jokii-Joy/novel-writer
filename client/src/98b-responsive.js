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

/* ------------------------------------------------------------ <= 560px -- */
@container nw (max-width: 560px){
  /* Below this the two-pane shell (shelf + paper) cannot both be readable, so
     the shelf lifts out of the flow and floats over the paper, and the splitter
     goes away because there is nothing left to drag. The width still comes from
     the inline style (the user may have set 300px); it is simply no longer
     taking room from the manuscript. */
  .nw-side{
    position:absolute;left:0;top:0;bottom:0;
    /* R117: above the bottom bar. The scrim is a sibling element, not the
       drawer's spread shadow: a shadow paints but cannot receive the tap that
       closes the drawer. */
    z-index:calc(var(--nw-z-panel) + 2);
    max-width:min(88%,320px);
    box-shadow:var(--nw-shadow-3);
  }
  .nw-side-scrim{
    position:absolute;inset:0;z-index:calc(var(--nw-z-panel) + 1);
    margin:0;padding:0;border:0;border-radius:0;
    background:rgba(0,0,0,.28);cursor:default;
    -webkit-tap-highlight-color:transparent;
  }
  .nw-splitter{display:none !important;}

  /* The advice panel does the same: overlay, anchored right. */
  .nw-suggest{
    position:absolute;right:0;top:0;bottom:0;z-index:var(--nw-z-panel);
    width:min(92%,360px) !important;max-width:92% !important;
    box-shadow:var(--nw-shadow-3);
  }

  /* R117: on a phone the manuscript owns the width. The old tier kept the
     88px lane (20 + 68) because the floating dock lived over the bottom-right
     of the paper; that left ~204px of text on a 390px screen — ten characters
     a line. The dock is a real bottom bar now (90-app.js), so the lane is
     gone and the page reads at the full measure. The edge handle also goes:
     the bar's 目录 item is the drawer door. */
  .nw-surface{--nw-pad-x:16px;--nw-pad-y:24px;--nw-gutter-x:0px;}
  /* 沉浸态在手机上仍要留一点呼吸：没有底栏要避让，但 16px 会贴到屏幕边。 */
  .nw-surface[data-immersive="1"]{--nw-pad-x:32px;--nw-pad-y:40px;--nw-gutter-x:0px;}
  .nw-shelfrestore{display:none;}
  /* Pinned over the top padding on desktop; on a phone the paragraph nav,
     首页 and 锁定 cover the first line as soon as the writer scrolls. 首页 and
     锁定 stay reachable in the shelf header, and the 更多 sheet has both. */
  .nw-surface-acts{display:none;}

  /* The notes card turns into a bottom sheet. It used to open as a 248px card
     over the first lines with only a hover-revealed close button — unusable on
     touch. The tab is hidden because 灵感 is a bar item now; the sheet ends
     exactly where the bar begins, so the two never overlap. */
  .nw-notes{
    left:0;right:0;top:auto;bottom:0;width:auto;max-height:min(62vh,440px);
    align-items:stretch;gap:0;pointer-events:none;
  }
  .nw-notes[data-open="1"]{pointer-events:auto;}
  .nw-notes-tab{display:none;}
  .nw-notes-card{
    width:100%;max-height:min(56vh,400px);
    border-radius:var(--nw-r-card) var(--nw-r-card) 0 0;
    border-bottom:0;
    box-shadow:0 -18px 48px rgba(0,0,0,.28);
  }
  /* Touch has no hover, so the corner close would stay invisible forever.
     Keep the state word + close button on screen and start the note below
     them; otherwise the first line runs under the button. */
  .nw-notes-tools{opacity:1;}
  .nw-notes-input{padding-top:38px;}

  /* Below the shelf overlay: when the shelf is lifted out of the flow it must
     be able to cover the dock, otherwise its bottom buttons are unreachable on
     a phone-sized panel. The compact bar is in flow, so it keeps its own box. */
  .nw-dock:not(.nw-dock-bar){right:10px;bottom:46px;z-index:var(--nw-z-panel);}

  /* Save state is the one thing that must stay visible; the word counters and
     the auto-save sentence are desktop wallpaper on a 390px bar. */
  .nw-status{padding:0 var(--nw-sp-2);font-size:12px;flex-wrap:wrap;row-gap:2px;height:auto;min-height:var(--nw-h-status);}
  .nw-status .nw-status-mid,.nw-status .nw-status-sync{display:none;}
}

/* Touch and coarse pointers: no hover, so anything that only appears on hover has
   to be visible on its own. R60: the dock is a FAB again and its menu rows already
   carry icon + name unconditionally, so all that is needed here is a readable
   resting opacity for the FAB itself — otherwise the circle would sit at 62% with
   nothing to reveal the rest. */
@media (hover: none){
  .nw-row-actions{opacity:1;}
  .nw-notes-tab{opacity:.85;}
  .nw-homebtn{opacity:.85;}
  .nw-dock-fab::before{opacity:1;}
}
`);
})();
