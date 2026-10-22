;(() => {
  'use strict';

  // ============================================================ Shell theme ==
  //
  // The plugin ships eight themes. The writing surface owns the paper and the ink
  // per theme inside 60-editor.js; this file carries the *shell* — toolbar,
  // sidebar, status bar, dialogs, dock — into the same palette.
  //
  // Mechanism: re-map the host's --dsw-alias-* vocabulary inside .nw-root only.
  // Every rule in the plugin colours itself from those aliases (directly, or
  // through the --nw-* derivation in 05-css.js), so one scoped remap moves the
  // whole chrome without touching a single component rule. Nothing outside
  // .nw-root is affected — the host's own UI keeps its own theme.
  //
  // `harness` deliberately has no branch: it is "follow the host", and any
  // selector here would pin the shell to a palette the host does not use.
  //
  // Values (docs/CONTRACT-R5.md §2):
  //   claude     paper #faf9f5 · ink #141413 · terracotta #d97757 · rule #e8e6dc
  //   eye        paper #cce8cf · ink #1f2a20 · accent #2f6b3c
  //   night      paper #1a1a18 · ink #e8e6dc · accent #e08d6f (terracotta lifted)
  //   ink        paper #f4f2ec · ink #1a1a18 · accent #2b2b28 (achromatic)
  //   card       paper #ffffff · ink #17181a · accent #3b6ea5 · r16
  //   newspaper  paper #f2eee2 · ink #1c1b17 · accent #8c2b22 · serif, r2
  //   guofeng    paper #f5f1e6 · ink #23211b · accent #a8442f · 楷体, r6
  // ===========================================================================
  NW.CSS_PARTS.push(`
/* ============================================================ claude ====== */
.nw-root[data-theme="claude"]{
  --dsw-alias-bg-base:#faf4e9;
  --dsw-alias-bg-layer-1:#f2ebdc;
  --dsw-alias-bg-layer-2:#e7ddca;
  --dsw-alias-bg-overlay:#fdf9f0;
  --dsw-alias-border-l1:#ece4d4;
  --dsw-alias-border-l2:#e2d7c3;
  --dsw-alias-brand-primary:#c4532f;
  --dsw-alias-label-primary:#1b1813;
  --dsw-alias-label-secondary:#6d6558;
  --dsw-alias-state-error-primary:#b8463c;
  --dsw-alias-state-idle-primary:#a8a49a;
  --dsw-alias-state-success-primary:#3f7d5a;
  --dsw-alias-state-warn-primary:#a9761d;
  --dsw-specific-sidebar-fill:#f3ecdd;
  color-scheme:light;
}

/* =============================================================== eye ====== */
.nw-root[data-theme="eye"]{
  --dsw-alias-bg-base:#cce8cf;
  --dsw-alias-bg-layer-1:#c5e3c8;
  --dsw-alias-bg-layer-2:#b9dcbd;
  --dsw-alias-bg-overlay:#d8eeda;
  --dsw-alias-border-l1:#c0dfc4;
  --dsw-alias-border-l2:#b6d6ba;
  --dsw-alias-brand-primary:#2f6b3c;
  --dsw-alias-label-primary:#1f2a20;
  --dsw-alias-label-secondary:#55684f;
  --dsw-alias-state-error-primary:#9c332e;
  --dsw-alias-state-idle-primary:#6d7d6b;
  --dsw-alias-state-success-primary:#2f7a42;
  --dsw-alias-state-warn-primary:#8a6410;
  --dsw-specific-sidebar-fill:#c3dfc6;
  color-scheme:light;
}

/* ============================================================= night ====== */
.nw-root[data-theme="night"]{
  --dsw-alias-bg-base:#1a1a18;
  --dsw-alias-bg-layer-1:#21201d;
  --dsw-alias-bg-layer-2:#292824;
  --dsw-alias-bg-overlay:#24231f;
  --dsw-alias-border-l1:#2c2b26;
  --dsw-alias-border-l2:#3a382f;
  --dsw-alias-brand-primary:#e08d6f;
  --dsw-alias-label-primary:#e8e6dc;
  --dsw-alias-label-secondary:#9c9a90;
  --dsw-alias-state-error-primary:#ef8272;
  --dsw-alias-state-idle-primary:#56554f;
  --dsw-alias-state-success-primary:#7cbf8f;
  --dsw-alias-state-warn-primary:#dfb765;
  --dsw-specific-sidebar-fill:#1f1e1b;
  /* On a dark ground the paper-on-paper shadows vanish unless they deepen. */
  --nw-shadow-1:0 1px 2px rgba(0,0,0,.42);
  --nw-shadow-2:0 8px 26px rgba(0,0,0,.48);
  --nw-shadow-3:0 2px 8px rgba(0,0,0,.46), 0 26px 68px rgba(0,0,0,.62);
  color-scheme:dark;
}
/* The modal is "paper": at night that means slightly *lighter* than the page,
   otherwise the sheet would read as a hole rather than a page. */
.nw-root[data-theme="night"] .nw-modal{background:#232220;}
.nw-root[data-theme="night"] .nw-toast{background:#2b2a26;}
.nw-root[data-theme="night"] .nw-dock-fab,
.nw-root[data-theme="night"] .nw-dock-btn{background:#2b2a26;}

/* =============================================================== ink ====== */
.nw-root[data-theme="ink"]{
  --dsw-alias-bg-base:#e9eef5;
  --dsw-alias-bg-layer-1:#e2e8f1;
  --dsw-alias-bg-layer-2:#d9e2ed;
  --dsw-alias-bg-overlay:#f6f9fc;
  --dsw-alias-border-l1:#dde5ee;
  --dsw-alias-border-l2:#d3dce6;
  --dsw-alias-brand-primary:#1f4f6b;
  --dsw-alias-label-primary:#121820;
  --dsw-alias-label-secondary:#5b6675;
  --dsw-alias-state-error-primary:#8f3b32;
  --dsw-alias-state-idle-primary:#8a95a3;
  --dsw-alias-state-success-primary:#3f6b57;
  --dsw-alias-state-warn-primary:#8a6a2a;
  --dsw-specific-sidebar-fill:#e4ebf3;
  color-scheme:light;
}

/* ============================================================== card ====== */
/* 极简卡片：白纸 + 无衬线 + 大圆角。Buttons and inputs drop their outline in
   favour of a soft fill, which is what makes the style read as "cards". */
.nw-root[data-theme="card"]{
  --dsw-alias-bg-base:#f9fbfd;
  --dsw-alias-bg-layer-1:#f0f4f9;
  --dsw-alias-bg-layer-2:#e8eef6;
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-border-l1:#e9eef5;
  --dsw-alias-border-l2:#dde4ee;
  --dsw-alias-brand-primary:#3b6ea5;
  --dsw-alias-label-primary:#17181a;
  --dsw-alias-label-secondary:#6b6f76;
  --dsw-alias-state-error-primary:#c0392b;
  --dsw-alias-state-idle-primary:#a3a8b0;
  --dsw-alias-state-success-primary:#2f8a63;
  --dsw-alias-state-warn-primary:#b07514;
  --dsw-specific-sidebar-fill:#f2f6fb;
  --nw-r-card:16px;
  --nw-r-control:12px;
  --nw-r-modal:18px;
  --nw-shadow-1:0 1px 3px rgba(23,24,26,.06);
  --nw-shadow-2:0 10px 30px rgba(23,24,26,.08);
  --nw-shadow-3:0 4px 12px rgba(23,24,26,.07), 0 30px 70px rgba(23,24,26,.14);
  --nw-ui-font-override:"Inter","Helvetica Neue","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  color-scheme:light;
}

/* ========================================================= newspaper ====== */
/* 报纸：新闻纸底、全衬线、直角。Serif UI + square corners are the whole point,
   so both are set here rather than left to the component defaults. */
.nw-root[data-theme="newspaper"]{
  --dsw-alias-bg-base:#ecdfbe;
  --dsw-alias-bg-layer-1:#e5d7b2;
  --dsw-alias-bg-layer-2:#dbcaa0;
  --dsw-alias-bg-overlay:#f5edd7;
  --dsw-alias-border-l1:#d9cfae;
  --dsw-alias-border-l2:#cfc399;
  --dsw-alias-brand-primary:#8c2b22;
  --dsw-alias-label-primary:#1c1b17;
  --dsw-alias-label-secondary:#5f5b4e;
  --dsw-alias-state-error-primary:#a33124;
  --dsw-alias-state-idle-primary:#a09a88;
  --dsw-alias-state-success-primary:#4a6b3d;
  --dsw-alias-state-warn-primary:#8a6410;
  --dsw-specific-sidebar-fill:#e8dbb8;
  --nw-r-card:2px;
  --nw-r-control:2px;
  --nw-r-modal:3px;
  --nw-r-pill:2px;
  --nw-shadow-1:0 1px 2px rgba(28,27,23,.10);
  --nw-shadow-2:0 6px 20px rgba(28,27,23,.14);
  --nw-shadow-3:0 2px 8px rgba(28,27,23,.14), 0 22px 56px rgba(28,27,23,.20);
  --nw-ui-font-override:Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif;
  color-scheme:light;
}

/* ========================================================== magazine ====== */
/* 杂志 (R10)：亮白铜版纸、无衬线界面、编辑红做规则线与强调色。It is the one
   theme that is deliberately not bookish — a magazine page is a designed
   surface, so the accent carries more weight than the paper. Paper stays a
   flat colour (no gradient, no texture). */
.nw-root[data-theme="magazine"]{
  --dsw-alias-bg-base:#ffffff;
  --dsw-alias-bg-layer-1:#f7f8f9;
  --dsw-alias-bg-layer-2:#eef0f2;
  --dsw-alias-bg-overlay:#ffffff;
  --dsw-alias-border-l1:#e6e8eb;
  --dsw-alias-border-l2:#d8dbdf;
  --dsw-alias-brand-primary:#d0021b;
  --dsw-alias-label-primary:#14171a;
  --dsw-alias-label-secondary:#6a7078;
  --dsw-alias-state-error-primary:#c0392b;
  --dsw-alias-state-idle-primary:#a3a8b0;
  --dsw-alias-state-success-primary:#1f7a4d;
  --dsw-alias-state-warn-primary:#b07514;
  --dsw-specific-sidebar-fill:#fafbfc;
  --nw-r-card:14px;
  --nw-r-control:10px;
  --nw-r-modal:16px;
  --nw-shadow-1:0 1px 3px rgba(20,23,26,.06);
  --nw-shadow-2:0 12px 30px rgba(20,23,26,.08);
  --nw-shadow-3:0 4px 12px rgba(20,23,26,.06), 0 28px 64px rgba(20,23,26,.12);
  --nw-ui-font-override:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  color-scheme:light;
}

/* ========================================================== magazine rules */
/* The editorial accent is a rule, not a wash: a 2px red bar under the section
   headings and a red left edge on the active journal row is what makes a
   magazine page read as designed rather than merely white. */
.nw-root[data-theme="magazine"] .nw-settings-section > h3,
.nw-root[data-theme="magazine"] .nw-settings-section > h4{
  position:relative;
}
.nw-root[data-theme="magazine"] .nw-settings-section > h3::after{
  content:"";
  position:absolute;left:0;bottom:-6px;
  width:22px;height:2px;border-radius:1px;
  background:var(--dsw-alias-brand-primary);
}
.nw-root[data-theme="magazine"] .nw-journal-item[data-active="1"],
.nw-root[data-theme="magazine"] .nw-shelf-novel.is-active,
.nw-root[data-theme="magazine"] .nw-shelf-row[aria-selected="true"]{
  box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary);
}
.nw-root[data-theme="magazine"] .nw-btn[data-kind="primary"]{
  font-weight:600;
  letter-spacing:.01em;
}

/* =========================================================== guofeng ====== */
/* 国风水墨：宣纸底、宋体界面、朱砂强调。 */
.nw-root[data-theme="guofeng"]{
  --dsw-alias-bg-base:#f2e9d2;
  --dsw-alias-bg-layer-1:#ece1c2;
  --dsw-alias-bg-layer-2:#e3d6b2;
  --dsw-alias-bg-overlay:#f9f1dc;
  --dsw-alias-border-l1:#e2d6bb;
  --dsw-alias-border-l2:#d8caa8;
  --dsw-alias-brand-primary:#a8442f;
  --dsw-alias-label-primary:#23211b;
  --dsw-alias-label-secondary:#6a6455;
  --dsw-alias-state-error-primary:#9c3326;
  --dsw-alias-state-idle-primary:#a49d8b;
  --dsw-alias-state-success-primary:#4b6b4a;
  --dsw-alias-state-warn-primary:#8a6410;
  --dsw-specific-sidebar-fill:#eee3c6;
  --nw-r-card:8px;
  --nw-r-control:6px;
  --nw-shadow-1:0 1px 2px rgba(35,33,27,.08);
  --nw-shadow-2:0 8px 26px rgba(35,33,27,.12);
  --nw-shadow-3:0 2px 8px rgba(35,33,27,.10), 0 24px 60px rgba(35,33,27,.18);
  --nw-ui-font-override:"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif;
  color-scheme:light;
}

/* ---------------------------------------------------------------------------
   Shared theme polish. These are shell-level adjustments that are true for every
   theme that is not "follow the host": the toolbar carries no separate fill (the
   page colour runs through it) and the status bar keeps only its hairline.
   ------------------------------------------------------------------------- */
.nw-root[data-theme="claude"] .nw-toolbar,
.nw-root[data-theme="eye"] .nw-toolbar,
.nw-root[data-theme="ink"] .nw-toolbar,
.nw-root[data-theme="card"] .nw-toolbar,
.nw-root[data-theme="newspaper"] .nw-toolbar,
.nw-root[data-theme="guofeng"] .nw-toolbar{
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--nw-surface-overlay) 55%, transparent), transparent 84%),
    var(--nw-bg);
}
.nw-root[data-theme="night"] .nw-toolbar{
  background:
    linear-gradient(180deg, rgba(255,255,255,.03), transparent 84%),
    var(--nw-bg);
}

/* ---------------------------------------------------------------------------
   Per-theme control shapes. The aliases above only move colour; a theme that
   changes its *form language* (square newspaper, pill-shaped cards) has to say
   so explicitly, otherwise every theme keeps the Claude control geometry.
   ------------------------------------------------------------------------- */
.nw-root[data-theme="newspaper"] .nw-btn,
.nw-root[data-theme="newspaper"] .nw-iconbtn,
.nw-root[data-theme="newspaper"] .nw-input,
.nw-root[data-theme="newspaper"] .nw-select,
.nw-root[data-theme="newspaper"] .nw-chip,
.nw-root[data-theme="newspaper"] .nw-modal,
.nw-root[data-theme="newspaper"] .nw-card,
.nw-root[data-theme="newspaper"] .nw-journal-item,
.nw-root[data-theme="newspaper"] .nw-choice{
  border-radius:2px;
}
.nw-root[data-theme="newspaper"] .nw-toolbar,
.nw-root[data-theme="newspaper"] .nw-statusbar{
  border-bottom-width:2px;
}
.nw-root[data-theme="newspaper"] .nw-toolbar-label,
.nw-root[data-theme="newspaper"] .nw-title{
  font-family:Georgia,"Times New Roman","Songti SC",serif;
  letter-spacing:.01em;
}
.nw-root[data-theme="newspaper"] .nw-dialog-title,
.nw-root[data-theme="newspaper"] .nw-section-title{
  font-variant:small-caps;
  letter-spacing:.06em;
}

.nw-root[data-theme="card"] .nw-btn,
.nw-root[data-theme="card"] .nw-iconbtn,
.nw-root[data-theme="card"] .nw-input,
.nw-root[data-theme="card"] .nw-select{
  border-radius:12px;
}
.nw-root[data-theme="card"] .nw-modal{
  border-radius:18px;
  border:1px solid var(--dsw-alias-border-l1);
}
.nw-root[data-theme="card"] .nw-card,
.nw-root[data-theme="card"] .nw-journal-item,
.nw-root[data-theme="card"] .nw-choice,
.nw-root[data-theme="card"] .nw-setting-group{
  border-radius:16px;
  border-color:transparent;
  box-shadow:var(--nw-shadow-1);
  background:var(--nw-surface-overlay);
}
.nw-root[data-theme="card"] .nw-btn{
  border-color:transparent;
  background:var(--nw-sunken);
}
.nw-root[data-theme="card"] .nw-btn:hover{
  background:color-mix(in srgb, var(--dsw-alias-label-primary) 9%, var(--nw-bg));
}

.nw-root[data-theme="guofeng"] .nw-btn,
.nw-root[data-theme="guofeng"] .nw-iconbtn,
.nw-root[data-theme="guofeng"] .nw-input,
.nw-root[data-theme="guofeng"] .nw-select,
.nw-root[data-theme="guofeng"] .nw-modal,
.nw-root[data-theme="guofeng"] .nw-card{
  border-radius:6px;
}
.nw-root[data-theme="guofeng"] .nw-toolbar-label,
.nw-root[data-theme="guofeng"] .nw-title,
.nw-root[data-theme="guofeng"] .nw-dialog-title{
  font-family:"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif;
  letter-spacing:.08em;
}
/* 印章感：强调色只出现在实心主按钮上，像一方朱砂印。 */
.nw-root[data-theme="guofeng"] .nw-btn-primary{
  background:var(--dsw-alias-brand-primary);
  color:#faf6ea;
}
`);
})();
