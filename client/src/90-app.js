;(() => {
  'use strict';

  const PANEL_ID = 'novel-writer';
  const LS_NOVEL = 'nw.activeNovel';
  const LS_CHAPTER = 'nw.activeChapter';
  const LS_WIDTH = 'nw.shelfWidth';
  const LS_TYPE_SCALE = 'nw.typeScale.v3';
  const LS_SIDEBAR_AUTO = 'nw.sidebarAutoCollapsed';
  const LS_SHELF_OPEN = 'nw.shelfOpen';
// 修改建议 column (R12 ②): the writer who opens the critique panel usually
// wants it back next session, so both the toggle and the drag width persist.
const LS_ADVICE_OPEN = 'nw.adviceOpen';
const LS_ADVICE_WIDTH = 'nw.adviceWidth';
const LS_VIEW = 'nw.view';
const LS_LAST_CHAPTER = 'nw.lastChapterByNovel';
  const LS_NOTES_OPEN = 'nw.notesOpen';
  // R80: every localStorage key that is a preference (not the password verifier
  // and not the lock flag). These are mirrored to the host, because a host
  // reinstall can replace the whole WebView profile: the books come back from
  // the sync mirror, but the layout and the password used to be lost.
  const LS_PREF_KEYS = [
    LS_NOVEL, LS_CHAPTER, LS_WIDTH, LS_TYPE_SCALE, LS_SIDEBAR_AUTO, LS_SHELF_OPEN,
    LS_ADVICE_OPEN, LS_ADVICE_WIDTH, LS_VIEW, LS_LAST_CHAPTER, LS_NOTES_OPEN,
  ];
  let prefsHydrated = false;
  let prefsPushTimer = 0;
  let settingsPushTimer = 0;

  /** Debounced: mirror the layout prefs to the host (best effort). */
  function pushPrefsSoon() {
    if (!prefsHydrated || typeof window === 'undefined') return;
    if (prefsPushTimer) window.clearTimeout(prefsPushTimer);
    prefsPushTimer = window.setTimeout(() => {
      prefsPushTimer = 0;
      const prefs = {};
      for (let i = 0; i < LS_PREF_KEYS.length; i += 1) {
        const value = lsGet(LS_PREF_KEYS[i]);
        if (value != null) prefs[LS_PREF_KEYS[i]] = value;
      }
      try {
        if (NW.io && NW.io.client && typeof NW.io.client.savePrefs === 'function') {
          NW.io.client.savePrefs(prefs).catch(() => {});
        }
      } catch (err) {
        /* preferences are a convenience, never a blocker */
      }
    }, 1500);
  }

  /** Debounced: mirror the IndexedDB settings row to the host (best effort). */
  function pushSettingsSoon() {
    if (typeof window === 'undefined') return;
    if (settingsPushTimer) window.clearTimeout(settingsPushTimer);
    settingsPushTimer = window.setTimeout(() => {
      settingsPushTimer = 0;
      try {
        if (!NW.io || !NW.io.client || typeof NW.io.client.saveSettings !== 'function') return;
        Promise.resolve(NW.db.getSettings())
          .then((settings) => NW.io.client.saveSettings(settings))
          .catch(() => {});
      } catch (err) {
        /* best effort */
      }
    }, 1500);
  }

  /**
   * R80: fill in the layout preferences a wiped WebView profile lost.
   *
   * Only missing keys are touched — whatever this profile already recorded stays
   * authoritative, so a stale host copy can never move the panel around under the
   * writer. Runs once per page load, before `pickInitial()` reads the last
   * chapter, hence before `prefsHydrated` opens the push gate.
   */
  async function hydratePrefs() {
    try {
      if (!NW.io || !NW.io.client || typeof NW.io.client.state !== 'function') return;
      const state = await NW.io.client.state();
      const prefs = state && state.prefs;
      if (!prefs || typeof prefs !== 'object') return;
      for (let i = 0; i < LS_PREF_KEYS.length; i += 1) {
        const key = LS_PREF_KEYS[i];
        if (prefs[key] == null) continue;
        if (lsGet(key) == null) lsSet(key, String(prefs[key]));
      }
    } catch (err) {
      /* best effort */
    } finally {
      prefsHydrated = true;
    }
  }
  const DEFAULT_WIDTH = 272;
  // Host layout: the shell renders `data-sidebar-collapsed` on its frame and
  // exposes no getter for the rail state, so the attribute is the only signal.
  const SIDEBAR_COLLAPSED_SELECTOR = '[data-sidebar-collapsed]';

  // Chrome that belongs to the App shell rather than to the theme layer: the
  // floating action dock (bottom-right, never over the text) and the immersive
  // layout (which has no top bar at all — Esc is the only way out).
  NW.CSS_PARTS.push(`
.nw-main{position:relative;}
/* R12 ②: 修改建议 is a column beside the manuscript, not a modal. A dialog
   hides the text it is talking about; a column keeps the passage and the advice
   on screen at once, so 「这一段」 can actually be looked at while reading why. */
.nw-bench{
  display:flex;flex:1 1 auto;min-height:0;min-width:0;position:relative;
  /* R24: the notes lane is measured against the bench, not the panel — with the
     shelf open the bench is 272px narrower, and a lane that only checked the
     panel width would starve the manuscript exactly when the tree is visible. */
  container-type:inline-size;container-name:bench;
}
.nw-bench-paper{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;position:relative;}
/* R28 ①: the reserved lane is gone. R24/R27 carved 348px out of the manuscript by
   padding the surface, which narrowed the page and pushed the prose right the
   moment the card opened — the exact two things the writer asked us to stop
   doing. The card now lives inside the margin the centred page already leaves on
   its left, and its width is that margin (see .nw-notes below), so opening a
   note changes nothing about the manuscript: same measure, same position. */
/* R25: with the advice column open the manuscript stops growing — it pins itself
   to the page measure — and the advice column takes the rest, up to a ceiling.
   The pair is then centred as a unit, so the text and the suggestions always meet
   with just the page gutter between them instead of a dead margin, and the extra
   space on a wide monitor is split evenly outside the pair rather than dumped
   between the two columns. */
.nw-bench[data-advice="1"]{justify-content:center;}
.nw-bench[data-advice="1"] .nw-bench-paper{flex:0 1 auto;width:calc(min(var(--nw-page,760px),100%) + 32px);}
/* R73: 选中改写窗口是同一套并排逻辑——窗口开着的时候正文钉在版面宽度上，
   剩下的宽度给窗口，两边始终看得见。 */
.nw-bench[data-selwin="1"]{justify-content:center;}
.nw-bench[data-selwin="1"] .nw-bench-paper{flex:0 1 auto;width:calc(min(var(--nw-page,760px),100%) + 32px);}
/* 窄面板上两个都开着就都挤没了：窗口优先，正文保住最小可读宽度。 */
@media (max-width:820px){
  .nw-selwin{flex-basis:300px;}
}
/* R77 (B1): 面板窄到放不下「正文 + 320px 窗口」时，窗口改成浮层盖在右边，
   而不是把稿纸压成一条。判据跟侧栏浮层一样是面板宽度（container query），
   不是窗口宽度。 */
@container nw (max-width: 900px){
  .nw-selwin{
    position:absolute;right:10px;top:10px;bottom:10px;z-index:var(--nw-z-float);
    margin:0;width:min(420px,92%);flex:0 0 auto;
    box-shadow:0 18px 48px rgba(0,0,0,.28);
  }
  .nw-bench[data-selwin="1"] .nw-bench-paper{width:auto;flex:1 1 auto;}
}
/* R77 (B4): 卡片进场跟着全站时长，不再「啪」地出现。key 是条目 id，所以重绘
   不会重播，只有真的新增一张卡时才播一次。 */
.nw-adv{animation:nw-fade-in var(--nw-dur) var(--nw-ease,ease) both;}
/* R28 ①: the note card no longer takes a lane, so this branch is gone. With the
   advice column open the paper is pinned to the page measure and centred as a
   pair — the card simply rides along inside that paper's left margin. */
/* …except there is no margin left at that point: the paper is page + 32px, so
   the gutter is 16px. Rather than let a 40px sliver pretend to be a panel, the
   card steps aside while the advice column is open — the advice column is a
   review mode, and closing it brings the notes straight back. */
.nw-bench[data-advice="1"] .nw-notes{display:none;}
.nw-suggest{
  position:relative;
  flex:0 0 auto;display:flex;flex-direction:column;min-height:0;
  /* R21: this class name is shared with the proofread suggestion *card*
     (45-dialogs-css.js), which sets align-items:flex-start + gap:8px. On the
     panel that made every child shrink to its text width (the note box came out
     181px inside a 336px panel). Both are pinned back here. */
  align-items:stretch;gap:0;
  /* R25: the column used to be a fixed 336px, which left a wide blank margin
     between the page and the panel — the page is capped at --nw-width and centred
     inside its column, so the leftover was split on both sides. Now the manuscript
     column is pinned to the page measure while the advice column is open (see
     .nw-bench[data-advice="1"] below) and this column simply grows into whatever
     is left, so it always sits flush against the text. The 300px floor is what
     the manuscript is never allowed to eat into. */
  /* R25: basis 300px, not auto — with an auto basis the max-width becomes the
     flex base, and the paper then had to shrink to make room for a column that
     was mostly empty. The column grows into the leftover instead. */
  flex:1 1 300px;min-width:300px;max-width:560px;
  /* R25: the auto width stops at 560px so the column never eats the manuscript
     on a wide screen, but a hand-dragged width is an explicit request — the
     grip's own ceiling is 640px, so the cap has to move with it or dragging
     past 560px would silently do nothing. */
  /* R21: palette tokens, so the column follows the reading theme (it used to be
     a white strip beside a dark page). */
  border-left:1px solid var(--nw-line);
  background:var(--nw-panel);
  animation:nw-slide-in var(--nw-dur) var(--nw-ease,ease);
}
/* R25: once the writer drags the grip the column is no longer "auto", so the
   560px auto cap must not clamp it. The 640px grip ceiling still applies. */
.nw-suggest[data-manual="1"]{max-width:640px;}
/* R19 B2: adviceWidth and its localStorage key have existed since R12, but
   nothing ever called the setter — the column was 336px forever. This grip is
   the missing half: the same pointer-drag idiom as .nw-splitter, mirrored to
   the panel's left edge (dragging left makes the panel wider). */
.nw-suggest-grip{
  position:absolute;left:-3px;top:0;bottom:0;width:6px;z-index:var(--nw-z-float);
  cursor:col-resize;background:transparent;border:0;padding:0;
  transition:background var(--nw-dur) var(--nw-ease,ease);
}
.nw-suggest-grip:hover,.nw-suggest-grip:focus-visible,.nw-suggest-grip[data-drag="1"]{
  background:color-mix(in srgb, var(--nw-brand) 45%, transparent);
  outline:none;
}
@keyframes nw-slide-in{from{opacity:0;transform:translateX(14px);}to{opacity:1;transform:none;}}
.nw-suggest-head{
  display:flex;align-items:center;gap:var(--nw-sp-1);flex:0 0 auto;
  padding:10px 10px 8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);
}
.nw-suggest-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}
.nw-suggest-count{font-size:12px;color:var(--dsw-alias-label-secondary);}
.nw-suggest-body{flex:1 1 auto;min-height:0;overflow:auto;padding:var(--nw-sp-2);display:flex;flex-direction:column;gap:var(--nw-sp-1);}
/* R73: the column is now body + a pinned 已接收 section under it. The main
   wrapper owns the leftover height so the folded directory never floats. */
.nw-suggest-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.nw-suggest-acceptedwrap{flex:0 0 auto;padding:0 12px 10px;max-height:46%;overflow:auto;}
.nw-suggest-acceptedwrap:empty{display:none;}
.nw-advice{
  display:flex;flex-direction:column;gap:var(--nw-sp-0);padding:11px 12px;
  border-radius:var(--nw-r-card);border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);cursor:pointer;text-align:left;
  font-family:inherit;
  transition:border-color var(--nw-dur) ease,box-shadow var(--nw-dur) ease,transform var(--nw-dur) ease;
}
.nw-advice:hover{border-color:var(--dsw-alias-border-l2);transform:translateY(-1px);}
.nw-advice[data-active="1"]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);}
.nw-advice-quote{
  font-family:var(--nw-reading-font,inherit);font-size:13px;line-height:1.7;
  color:var(--dsw-alias-label-secondary);
  /* R84: the quote used to wear an underline that matched the sentence in the
     manuscript. Both are gone now — the writer asked for highlight-only marks.
     The quote still reads as a quotation through the reading face and the
     secondary colour, and the paper wash is what links it to the sentence. */
  padding-bottom:2px;
  max-height:4.8em;overflow:hidden;
}
.nw-advice[data-active="1"] .nw-advice-quote{color:var(--dsw-alias-label-primary);}
.nw-advice-issue{font-size:var(--nw-fs-micro);font-weight:600;line-height:1.55;color:var(--dsw-alias-label-primary);}
/* R19 B3: eight cards × five lines was a wall of grey. The quote and the advice
   are what the writer reads; the reasoning collapses to a single clamped line
   and the rewrite example to two. Nothing is lost — hovering a card or opening
   it (data-active) unfolds the whole thing. */
.nw-advice-why{
  font-size:var(--nw-fs-tiny);line-height:1.65;color:var(--dsw-alias-label-secondary);
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;
}
.nw-advice:hover .nw-advice-why,.nw-advice[data-active="1"] .nw-advice-why{
  display:block;-webkit-line-clamp:unset;overflow:visible;
}
.nw-advice-do{
  font-size:var(--nw-fs-micro);line-height:1.65;color:var(--dsw-alias-label-primary);
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
}
.nw-advice:hover .nw-advice-do,.nw-advice[data-active="1"] .nw-advice-do{
  display:block;-webkit-line-clamp:unset;overflow:visible;
}
/* The suggested rewrite is quoted prose, so it gets the reading face and a
   tinted block instead of another paragraph of grey — it is the one part of the
   card the writer may copy straight into the manuscript. */
.nw-advice-example{
  font-family:var(--nw-reading-font,inherit);font-size:var(--nw-fs-micro);line-height:1.75;
  padding:7px 10px;border-radius:var(--nw-r-control);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, var(--dsw-alias-bg-layer-1));
  border:1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, var(--dsw-alias-border-l1));
  color:var(--dsw-alias-label-primary);
  white-space:pre-wrap;word-break:break-word;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
}
.nw-advice:hover .nw-advice-example,.nw-advice[data-active="1"] .nw-advice-example{
  display:block;-webkit-line-clamp:unset;overflow:visible;
}
.nw-advice-kind{
  align-self:flex-start;font-size:var(--nw-fs-tiny);line-height:1;padding:3px 7px;border-radius:var(--nw-r-pill);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);
}
.nw-advice-kind[data-sev="high"]{
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color:var(--dsw-alias-state-error-primary);
}
.nw-advice-kind[data-sev="low"]{opacity:.72;}
.nw-advice-foot{display:flex;align-items:center;gap:var(--nw-sp-0);flex-wrap:wrap;}
/* Ten dimensions do not fit one segmented control, and a <select> would hide
   nine tenths of them behind a click. Chips wrap onto as many rows as needed. */
.nw-advice-focus{
  flex:0 0 auto;display:flex;flex-wrap:wrap;gap:var(--nw-sp-0);
  padding:8px 12px 9px;border-bottom:1px solid var(--dsw-alias-border-l1);
}
.nw-advice-chip{
  height:24px;padding:0 10px;border-radius:var(--nw-r-pill);
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);
  font-family:inherit;font-size:12px;line-height:22px;cursor:pointer;
  transition:background var(--nw-dur) ease,border-color var(--nw-dur) ease,color var(--nw-dur) ease;
}
.nw-advice-chip:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}
.nw-advice-chip[data-on="1"]{
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-base));
  border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 46%, var(--dsw-alias-border-l1));
  color:var(--dsw-alias-brand-primary);font-weight:600;
}
.nw-advice-chip:disabled{opacity:.5;cursor:default;}
.nw-advice-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
/* The writer's own instruction. It sits above the list, not in a dialog: the
   whole point of typing 「只看结尾」 is to re-run with it immediately. */
.nw-advice-note{flex:0 0 auto;padding:0 12px 9px;}
/* R21: min-height was 34px, i.e. one clipped line — the two-line placeholder was
   cut in half and the field read as a broken input. It now starts at two rows
   and grows with the text up to 96px. Colours also come from the reading palette
   instead of the host aliases, or the box stays white on the night theme. */
.nw-advice-note textarea{
  display:block;width:100%;box-sizing:border-box;
  min-height:52px;max-height:96px;resize:vertical;overflow:auto;
  padding:8px 10px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);
  background:var(--nw-sunken);color:var(--nw-fg);
  font-family:inherit;font-size:var(--nw-fs-tiny);line-height:1.65;
}
.nw-advice-note textarea:focus{
  outline:none;border-color:var(--nw-brand);
  box-shadow:0 0 0 2px color-mix(in srgb, var(--nw-brand) 18%, transparent);
}
.nw-advice-note textarea::placeholder{color:var(--nw-fg-soft);opacity:.85;}
.nw-advice-notebar{display:flex;align-items:center;gap:var(--nw-sp-0);margin-top:var(--nw-sp-0);}
.nw-advice-notehint{font-size:var(--nw-fs-tiny);color:var(--nw-fg-soft);opacity:.85;}
/* R85：粘贴其他 AI 建议的入口。做成文字按钮而不是第二个输入框，平时收起来，
   不跟「补充要求」抢视线。 */
.nw-advice-paste-toggle{
  border:0;background:none;padding:0;cursor:pointer;
  color:var(--nw-brand);font:inherit;font-size:var(--nw-fs-tiny);
  text-decoration:underline;text-underline-offset:2px;
}
.nw-advice-paste-toggle:hover{color:var(--nw-brand-strong,var(--nw-brand));}
.nw-advice-paste-toggle:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;border-radius:2px;}
/* R85/R87：粘贴面板是一张独立的导入卡：标题 + 格式说明 + 一个复制入口 +
   输入框。等宽格式块限高，面板整体限高，避免把下面的建议卡片挤没。 */
.nw-advice-paste{
  flex:0 0 auto;display:flex;flex-direction:column;gap:10px;
  margin:2px 0 8px;padding:12px;
  border:1px solid var(--nw-line);border-radius:10px;
  background:var(--nw-sunken);
  max-height:52vh;overflow:auto;
}
.nw-advice-paste-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.nw-advice-paste-title{font-size:12px;font-weight:600;color:var(--nw-fg);}
.nw-advice-paste-tag{
  font-size:10px;line-height:1.5;color:var(--nw-fg-soft);
  border:1px solid var(--nw-line);border-radius:999px;padding:1px 7px;
}
.nw-advice-paste-help{font-size:var(--nw-fs-tiny);line-height:1.7;color:var(--nw-fg-soft);}
.nw-advice-paste-fmtbox{
  display:flex;flex-direction:column;gap:6px;
  padding:8px 10px;border:1px solid var(--nw-line);border-radius:8px;
  background:var(--nw-bg,transparent);
}
.nw-advice-paste-fmtlabel{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:10.5px;color:var(--nw-fg-soft);
}
.nw-advice-paste-fmtnote{opacity:.8;}
.nw-advice-paste-fmt{
  margin:0;max-height:104px;overflow:auto;
  padding:0;border:0;background:none;color:var(--nw-fg-soft);
  font-family:var(--nw-ui-font,ui-monospace,monospace);font-size:10.5px;line-height:1.7;
  white-space:pre-wrap;word-break:break-word;
}
.nw-advice-paste-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.nw-advice-paste-copy{flex:0 0 auto;}
.nw-advice-paste-tip{font-size:10.5px;color:var(--nw-fg-soft);}
.nw-advice-paste-input{
  display:block;width:100%;box-sizing:border-box;
  min-height:104px;max-height:200px;resize:vertical;overflow:auto;
  padding:9px 11px;border-radius:8px;
  border:1px solid var(--nw-line);
  background:var(--nw-bg,transparent);color:var(--nw-fg);
  font-family:var(--nw-ui-font,ui-monospace,monospace);font-size:11px;line-height:1.7;
}
.nw-advice-paste-input:focus{
  outline:none;border-color:var(--nw-brand);
  box-shadow:0 0 0 2px color-mix(in srgb, var(--nw-brand) 18%, transparent);
}
.nw-advice-paste-input::placeholder{color:var(--nw-fg-soft);opacity:.75;}
.nw-advice-paste-error{
  font-size:12px;line-height:1.55;color:var(--dsw-alias-state-error-primary);
}
.nw-advice-paste-actions{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding-top:2px;border-top:1px solid var(--nw-line);
}
.nw-advice-paste-actions-hint{margin-left:auto;font-size:10.5px;color:var(--nw-fg-soft);}
/* R73：角度是可选的。这行小字把「不选也行」说在明面上，否则十颗药丸默认全灭
   只会让人以为加载失败。 */
.nw-advice-focus-hint{
  flex:1 1 100%;font-size:10.5px;line-height:1.5;color:var(--nw-fg-soft);opacity:.75;
}
.nw-suggest-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--nw-sp-2);
  flex:1 1 auto;padding:24px 18px;text-align:center;
  color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7;
}
.nw-suggest-foot{
  flex:0 0 auto;display:flex;align-items:center;gap:var(--nw-sp-1);flex-wrap:wrap;
  padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1);
}
/* ======================= R73：选中改写 / 接受 / 已接收 =======================

   选中一段字 → 纸面上浮出一个小方钮 → 在正文右侧开一扇并排的窗口。窗口是
   .nw-bench 的第三个 flex 子项（和 修改建议 栏同一个位置逻辑），所以它**把正文
   挤窄**而不是盖在正文上：要看懂一条修改，原文和改后必须同时在视野里。

   卡片三态靠边框颜色区分：待定 / 已接受（绿）/ 已拒绝（红）。颜色读的是主题
   变量，所以换阅读主题时这三种状态不会有一格对不上。 */
.nw-selwin{
  position:relative;
  display:flex;flex-direction:column;min-height:0;min-width:0;
  flex:0 0 clamp(330px,31vw,440px);
  margin:12px 12px 12px 0;
  border:1px solid var(--nw-line-strong);
  border-radius:16px;
  background:var(--nw-panel);
  box-shadow:var(--nw-shadow-2,0 18px 40px rgba(0,0,0,.18));
  overflow:hidden;
  animation:nw-slide-in var(--nw-dur) var(--nw-ease,ease);
}
.nw-selwin-head{
  display:flex;align-items:center;gap:var(--nw-sp-1);flex:0 0 auto;
  padding:11px 10px 9px 14px;border-bottom:1px solid var(--nw-line);
}
.nw-selwin-title{font-size:14px;font-weight:600;color:var(--nw-fg);}
.nw-selwin-count{font-size:12px;color:var(--nw-fg-soft);}
.nw-selwin-src{
  flex:0 0 auto;margin:0 12px;padding:8px 10px;
  border-radius:10px;border:1px dashed var(--nw-line);
  background:var(--nw-sunken);
  font-family:var(--nw-reading-font,inherit);font-size:12px;line-height:1.7;color:var(--nw-fg-soft);
  max-height:5.4em;overflow:auto;white-space:pre-wrap;
}
.nw-selwin-body{
  flex:1 1 auto;min-height:0;overflow:auto;
  display:flex;flex-direction:column;gap:var(--nw-sp-1);
  padding:12px;
}
.nw-selwin-empty{
  flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:24px 18px;text-align:center;
  color:var(--nw-fg-soft);font-size:13px;line-height:1.7;
}
.nw-selwin-foot{
  flex:0 0 auto;display:flex;align-items:center;gap:var(--nw-sp-1);
  padding:9px 12px;border-top:1px solid var(--nw-line);
  font-size:11px;color:var(--nw-fg-soft);
}
/* R73: 已接收 folded under the cards, capped so it can never eat the窗口. */
.nw-selwin-accepted{
  flex:0 0 auto;max-height:46%;overflow:auto;padding:0 12px 10px;
}
.nw-selwin-accepted:empty{display:none;}
/* R76 (C2): 流式读取时卡片已经在屏幕上，而请求还没完——这一行说明后面可能还有。 */
.nw-selwin-progress{
  display:flex;align-items:center;gap:6px;
  padding:2px 2px 4px;font-size:11px;color:var(--nw-fg-soft);
}
.nw-selwin-progress[data-kind="warn"]{color:var(--nw-warn);}
/* R76 (A3): 这些结果是缓存来的，没有花第二次钱。 */
.nw-selwin-cached,.nw-suggest-cached{
  font-size:10.5px;color:var(--nw-fg-soft);opacity:.85;
  padding:1px 7px;border-radius:999px;border:1px dashed var(--nw-line);
}

/* 一张建议卡。整卡可点：点哪一处都把正文里的对应句子滚到视线中线并高亮。 */
.nw-adv{
  display:flex;flex-direction:column;gap:7px;
  padding:11px 12px;border-radius:var(--nw-r-card);
  border:1px solid var(--nw-line);
  background:var(--dsw-alias-bg-base);
  cursor:pointer;text-align:left;
  transition:border-color var(--nw-dur) ease, box-shadow var(--nw-dur) ease, transform var(--nw-dur) ease;
}
.nw-adv:hover{border-color:var(--nw-line-strong);transform:translateY(-1px);}
.nw-adv:focus-visible{outline:2px solid var(--nw-brand);outline-offset:2px;}
/* 三态：接受=绿，拒绝=红。色块很淡，只做边缘提示，不抢正文。 */
/* R76 (B4): 状态不能只靠一层淡淡的底色——夜间主题里 6% 的绿几乎看不见。
   左边一条 3px 的实色竖条 + 稍重的描边 + 10% 的底，在白天和夜里都站得住；
   文字仍然走主题色，所以对比度跟着宿主走。 */
.nw-adv[data-state="accepted"]{
  border-color:color-mix(in srgb, var(--nw-ok) 70%, var(--nw-line));
  border-left:3px solid var(--nw-ok);
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--nw-ok) 34%, transparent);
  background:color-mix(in srgb, var(--nw-ok) 10%, var(--dsw-alias-bg-base));
}
.nw-adv[data-state="rejected"]{
  border-color:color-mix(in srgb, var(--nw-danger) 65%, var(--nw-line));
  border-left:3px solid var(--nw-danger);
  background:color-mix(in srgb, var(--nw-danger) 8%, var(--dsw-alias-bg-base));
  opacity:.92;
}
/* R76 (A1): 这一条已经被替换进正文了——再淡一层底，并把状态写在左边。 */
.nw-adv[data-applied="1"]{
  border-left:3px solid var(--nw-brand);
  background:color-mix(in srgb, var(--nw-brand) 8%, var(--dsw-alias-bg-base));
}
.nw-adv[data-active="1"]{border-color:var(--nw-brand);box-shadow:inset 0 0 0 1px var(--nw-brand);}
.nw-adv-compare{
  display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;
}
.nw-adv-side{min-width:0;display:flex;flex-direction:column;gap:3px;}
.nw-adv-tag{
  font-size:10px;letter-spacing:.08em;color:var(--nw-fg-soft);text-transform:uppercase;
}
.nw-adv-txt{
  font-family:var(--nw-reading-font,inherit);font-size:12.5px;line-height:1.72;
  color:var(--nw-fg);white-space:pre-wrap;word-break:break-word;
  max-height:8.6em;overflow:auto;
}
.nw-adv-side[data-kind="old"] .nw-adv-txt{
  color:var(--nw-fg-soft);
  text-decoration:underline;text-decoration-color:color-mix(in srgb, var(--nw-danger) 55%, transparent);
  text-decoration-thickness:1px;text-underline-offset:3px;
}
.nw-adv-side[data-kind="new"] .nw-adv-txt{
  padding:6px 8px;border-radius:8px;
  background:color-mix(in srgb, var(--nw-ok) 8%, var(--nw-sunken));
  border:1px dashed color-mix(in srgb, var(--nw-ok) 38%, var(--nw-line));
}
/* R76 (A2): 字符级差异。删掉的字在原文一侧压一道浅红底 + 删除线，补上的字在
   改后一侧压一道浅绿底——字体颜色不动，所以夜间主题下也不会变成一片荧光。 */
.nw-diff-del{
  background:color-mix(in srgb, var(--nw-danger) 22%, transparent);
  color:inherit;border-radius:2px;
  text-decoration:line-through;
  text-decoration-color:color-mix(in srgb, var(--nw-danger) 70%, transparent);
  padding:0 .5px;
}
.nw-diff-add{
  background:color-mix(in srgb, var(--nw-ok) 26%, transparent);
  color:inherit;border-radius:2px;padding:0 .5px;
}
/* R76 (A1): 改后文字下面那一排动作：复制 / 替换 / 再改一版。 */
.nw-adv-acts{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.nw-adv-mini{
  display:inline-flex;align-items:center;gap:4px;
  height:22px;padding:0 8px;border-radius:999px;
  border:1px solid var(--nw-line);background:transparent;color:var(--nw-fg-soft);
  font-family:inherit;font-size:10.5px;font-weight:600;cursor:pointer;
  transition:border-color var(--nw-dur) ease,color var(--nw-dur) ease,background var(--nw-dur) ease;
}
.nw-adv-mini:hover:not(:disabled){color:var(--nw-fg);border-color:var(--nw-line-strong);background:color-mix(in srgb, var(--nw-fg) 5%, transparent);}
.nw-adv-mini[data-kind="apply"]{color:var(--nw-brand);border-color:color-mix(in srgb, var(--nw-brand) 40%, var(--nw-line));}
.nw-adv-mini[data-kind="apply"]:hover:not(:disabled){background:color-mix(in srgb, var(--nw-brand) 10%, transparent);}
.nw-adv-mini[data-kind="undo"]{color:var(--nw-warn);border-color:color-mix(in srgb, var(--nw-warn) 40%, var(--nw-line));}
.nw-adv-mini:disabled{opacity:.45;cursor:default;}
.nw-adv-ver{
  font-size:10px;padding:1px 6px;border-radius:999px;
  border:1px dashed color-mix(in srgb, var(--nw-brand) 45%, var(--nw-line));
  color:var(--nw-brand);
}
.nw-adv-issue{font-size:var(--nw-fs-micro);font-weight:600;line-height:1.55;color:var(--nw-fg);}
.nw-adv-why{font-size:var(--nw-fs-tiny);line-height:1.65;color:var(--nw-fg-soft);}
.nw-adv-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:1px;}
.nw-adv-kind{
  font-size:10px;padding:1px 6px;border-radius:999px;
  border:1px solid var(--nw-line);color:var(--nw-fg-soft);
}
.nw-adv-btn{
  height:24px;padding:0 10px;border-radius:999px;
  border:1px solid var(--nw-line-strong);background:transparent;
  color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);font-weight:600;
  transition:background var(--nw-dur) ease,color var(--nw-dur) ease,border-color var(--nw-dur) ease;
}
.nw-adv-btn:hover{background:var(--nw-btn-hover,color-mix(in srgb, var(--nw-fg) 6%, transparent));}
.nw-adv-btn[data-kind="accept"]{color:var(--nw-ok);border-color:color-mix(in srgb, var(--nw-ok) 45%, var(--nw-line-strong));}
.nw-adv-btn[data-kind="accept"]:hover{background:color-mix(in srgb, var(--nw-ok) 12%, transparent);}
.nw-adv-btn[data-kind="reject"]{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 35%, var(--nw-line-strong));}
.nw-adv-btn[data-kind="reject"]:hover{background:color-mix(in srgb, var(--nw-danger) 10%, transparent);}
.nw-adv-btn:disabled{opacity:.45;cursor:default;background:transparent;}

/* 已接收：折叠起来的目录。一条区域改了两次以上时，记录按时间顺序排在一起，
   每条带 ①②③ 的顺序标记，左边一条竖线把它们括成一组。 */
.nw-accepted{flex:0 0 auto;display:flex;flex-direction:column;gap:0;margin-top:2px;}
.nw-accepted-head{
  display:flex;align-items:center;gap:6px;
  padding:8px 10px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);background:var(--nw-sunken);
  color:var(--nw-fg-soft);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);font-weight:600;text-align:left;
}
.nw-accepted-head:hover{color:var(--nw-fg);border-color:var(--nw-line-strong);}
.nw-accepted-caret{display:inline-flex;transition:transform var(--nw-dur) ease;}
.nw-accepted[data-open="1"] .nw-accepted-caret{transform:rotate(90deg);}
.nw-accepted-body{display:none;flex-direction:column;gap:6px;padding:8px 0 2px 4px;}
.nw-accepted[data-open="1"] .nw-accepted-body{display:flex;}
.nw-acc-group{
  display:flex;flex-direction:column;gap:5px;
  padding-left:9px;border-left:2px solid color-mix(in srgb, var(--nw-ok) 40%, transparent);
}
.nw-acc-row{
  display:flex;align-items:flex-start;gap:7px;
  padding:7px 9px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);background:var(--dsw-alias-bg-base);
  cursor:pointer;text-align:left;font-family:inherit;
  transition:border-color var(--nw-dur) ease,background var(--nw-dur) ease;
}
.nw-acc-row:hover{border-color:var(--nw-line-strong);}
.nw-acc-row[data-active="1"]{border-color:var(--nw-brand);}
.nw-acc-ord{
  flex:0 0 auto;width:18px;height:18px;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:var(--nw-ok);
  background:color-mix(in srgb, var(--nw-ok) 14%, transparent);
}
.nw-acc-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.nw-acc-quote{
  font-family:var(--nw-reading-font,inherit);font-size:12px;line-height:1.6;color:var(--nw-fg-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-acc-rev{
  font-family:var(--nw-reading-font,inherit);font-size:12px;line-height:1.6;color:var(--nw-fg);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nw-acc-meta{flex:0 0 auto;font-size:10px;color:var(--nw-fg-soft);opacity:.8;}
.nw-acc-drop{
  flex:0 0 auto;width:20px;height:20px;border:0;border-radius:50%;
  background:transparent;color:var(--nw-fg-soft);cursor:pointer;line-height:1;
  font-size:13px;
}
.nw-acc-drop:hover{background:color-mix(in srgb, var(--nw-danger) 12%, transparent);color:var(--nw-danger);}
/* R6: 收起侧栏 曾是一扇单向门 —— 仓库头部的收起按钮随侧栏一起消失，回来只能靠
   浮动坞（先点圆钮再点「显示目录」）。这个把手常驻在写作列左缘，任何时刻一次点击
   就能把目录要回来。沉浸模式不渲染它（沉浸是纯画布，Esc 退出）。 */
.nw-shelfrestore{
  position:absolute;z-index:var(--nw-z-float);left:0;top:50%;transform:translateY(-50%);
  display:inline-flex;flex-direction:column;align-items:center;gap:var(--nw-sp-1);
  padding:10px 6px;border-radius:0 10px 10px 0;
  border:1px solid var(--dsw-alias-border-l1);border-left:none;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;opacity:.5;font-size:12px;line-height:1;
  transition:opacity var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
             color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
             padding var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-shelfrestore:hover,.nw-shelfrestore:focus-visible{
  opacity:1;color:var(--dsw-alias-label-primary);padding-left:var(--nw-sp-2);
}
.nw-shelfrestore-txt{writing-mode:vertical-rl;letter-spacing:.2em;max-height:72px;overflow:hidden;}
.nw-shelfrestore-ico{display:inline-flex;flex:0 0 auto;}
/* ---- 浮动坞（R61）--------------------------------------------------------
   R57 把它摊成五枚常驻单字，R58 给它一块玻璃板，R59 才发现「点了没反应」
   的病灶根本不在按钮上——是坞自己的 padding 在子元素之间留了一圈可命中的
   死区。用户看完这一圈折腾说「还是改回悬浮坞吧」，于是 R60 收回成圆钮。

   R61：用户在桌面同一位置点了一下，弹出的是**别的程序**的悬浮球菜单
   （打开桌面端 / 开始全部任务 / 查看传输列表 / 隐藏悬浮球 / 取消置顶）。
   也就是说五轮「上半部分是箭头 / 点了没反应」的真正原因是：那颗一直置顶的
   悬浮球压在应用窗口的右下角，指针和点击都被它接走了。插件这边的 CSS 从
   头到尾都是对的。

   位置曾因此上移到 bottom:104px 躲避那颗球；R62 用户关掉了球，位置撤回原位。
   留下的是那次排查真正属于本插件的那条结论，钉在这里别再丢：**坞的容器不许
   拥有可命中面积**——没有 padding、没有 gap、不画背景、不画边框，所有看得见
   的东西都由按钮或伪元素画。 */
/* R63：五行的度量收到容器上的三个变量里——图标格宽、行内间距、行首内边距
   都由它们算出来，窄屏断点只改这三个数，行的左边界就永远是一条线。
   R65：用户要「每一个都是独立的按钮，按钮间有点间隔」，于是整张卡片撤掉，五行
   自己就是五个按钮。间隔是用**每行自己的内缩**做出来的（上下各缩 4px，两行之间
   自然空出 8px），不是给容器加 gap——gap 属于容器，指针落进那条缝时命中的是一个
   不画东西的 div，正好是 R59 那个死区的另一副面孔。
   上面 R59 那三条硬规矩没有变：容器不 padding、不 gap、不画底不画框。 */
.nw-dock{
  position:absolute;z-index:var(--nw-z-panel);
  right:22px;bottom:60px;
  display:flex;flex-direction:column;align-items:flex-end;
  padding:0;gap:0;
  border:0;background:none;box-shadow:none;
  --nw-dock-pad-l:10px;
  --nw-dock-tile:26px;
  --nw-dock-gap:10px;
  /* R65：现在只剩按钮自己需要材料，所以只留一个值。
     浅色主题里它是「纸色 + 4% 墨」（比纸深一档）；夜盘反而要往上提——深色页面
     上的浮层靠更亮表示抬起，7% 那条覆盖写在 98-shell-theme.js 里。 */
  --nw-dock-card:color-mix(in srgb, var(--nw-fg) 4%, var(--nw-bg));
}
.nw-dock[data-immersive="1"]{bottom:22px;right:18px;}

/* 菜单：五行按钮的柱子。它自己不画任何东西——R65 之后这里既没有卡片也没有
   尖角，展开时看到的就是五个独立的按钮，收起来时它们一起消失，只剩圆钮。 */
.nw-dock-menu{
  position:relative;isolation:isolate;
  /* R66：不再给柱子定宽，也不再让按钮把它撑满。每枚按钮只长得像它自己的
     字——五个名字长短不同，宽度就该不同；右缘对齐圆钮，左缘随字走。
     stretch 会让五枚一样长，正是用户说的「为啥要一样长」。 */
  display:flex;flex-direction:column;align-items:flex-end;
  /* margin 不是死区：它不属于任何盒子，指针在那条缝里落到的是正文。 */
  margin:0 0 8px;
  padding:0;gap:0;
  transform-origin:100% 100%;
  animation:nw-dock-rise .22s var(--nw-ease-pop, cubic-bezier(.22,1.16,.36,1)) both;
}
.nw-dock-menu[data-open="0"]{display:none;}
@keyframes nw-dock-rise{
  from{opacity:0;transform:translateY(8px) scale(.95);}
  to{opacity:1;transform:none;}
}
/* 开放时五行依次浮起，每行晚 30ms——卡片先出来，字随后落定。
   只在展开态挂动画（收起时 display:none，再展开自然重播）。 */
@keyframes nw-dock-row-in{
  from{opacity:0;transform:translateY(4px);}
  to{opacity:1;transform:none;}
}
.nw-dock-menu[data-open="1"] .nw-dock-btn{
  animation:nw-dock-row-in .2s var(--nw-ease, ease) both;
}
.nw-dock-menu[data-open="1"] .nw-dock-btn:nth-child(2){animation-delay:.03s;}
.nw-dock-menu[data-open="1"] .nw-dock-btn:nth-child(3){animation-delay:.06s;}
.nw-dock-menu[data-open="1"] .nw-dock-btn:nth-child(4){animation-delay:.09s;}
.nw-dock-menu[data-open="1"] .nw-dock-btn:nth-child(5){animation-delay:.12s;}

/* 一行就是一个按钮：矩形盒子应答指针，形状由 ::before 画。
   盒子无圆角、无边框、无背景、无子元素应答指针——浏览器只有一个盒子要测。
   R63：行高 44 → 42，图标格 24 → 26 并加一圈发丝内描边（读起来像一枚
   压出来的工具格，而不是一块灰色补丁）；行首文字 13 → 14 并加 500 字重。
   R65：卡片撤掉之后，五个按钮各自长出自己的皮——纸色底、发丝边、一点浮影；
   上下各内缩 4px 让按钮之间空出 8px，而**行盒子仍是连续的**：指针落到那条
   视觉缝里时命中的是相邻按钮的盒子，不会掉进一个不画东西的空档。 */
.nw-dock-btn{
  position:relative;isolation:isolate;
  display:flex;align-items:center;gap:var(--nw-dock-gap);
  /* R67：宽度不进布局，进变量 —— 五枚按钮从下到上依次变长（阶梯），
     右缘对齐圆钮，左缘一级一级退出去。min-width:max-content 是保险：
     哪天某个名字长过它那一级，宁可破坏阶梯也不许把字裁掉。 */
  width:var(--nw-dock-w, auto);min-width:max-content;max-width:100%;
  /* R67：内容是两端对齐的 —— 图标贴着左端，名字贴着右端，多出来的宽度
     全部留在中间。这样按钮可以长短不一而两侧都不留白边。 */
  justify-content:space-between;
  height:var(--nw-dock-h, 42px);padding:0 13px 0 var(--nw-dock-pad-l);
  border-radius:0;border:0;background:transparent;
  color:color-mix(in srgb, var(--nw-fg) 82%, var(--nw-bg));
  font-size:var(--nw-fs-second);line-height:1;white-space:nowrap;
  text-align:left;
  cursor:pointer;
  /* R54c：没有 hover/active 位移。会变形的按钮会把自己的命中区从指针底下挪走。 */
  transition:color .16s var(--nw-ease, ease);
}
.nw-dock-btn:hover:not([data-blocked="1"]),
.nw-dock-btn:focus-visible{color:var(--nw-fg);}
/* R67：从下往上的一级级台阶 —— 越靠上越长，也略高一点点；右缘齐着圆钮，
   左缘一级一级退出去。宽度用 em，跟着字号一起缩；min-width:max-content
   是保险：哪天某个名字长过它那一级，宁可把台阶踩平，也不许把字裁掉。
   高度只给变量，窄屏那条 .nw-dock-btn{height:36px} 仍然能一把压平。
   R67b：宽度不是随手排的等差数列，而是「这一行自己起码要多宽 + 一样多的余量」。
   四字行 8.21em、'AI 校对' 7.5em、三字行 7.21em、两字行 6.21em（14px 字号下量出来的），
   各加 0.5em 余量就成了下面五个数。上一版顶层给到 10.4em 而那一行只有四字，
   左边空出一大块——用户说的「AI 校对按钮左边的空白太多了」就是这个。 */
.nw-dock-menu .nw-dock-btn:nth-child(1){--nw-dock-w:8.7em;--nw-dock-h:46px;}
.nw-dock-menu .nw-dock-btn:nth-child(2){--nw-dock-w:8.7em;--nw-dock-h:44px;}
.nw-dock-menu .nw-dock-btn:nth-child(3){--nw-dock-w:8em;--nw-dock-h:42px;}
.nw-dock-menu .nw-dock-btn:nth-child(4){--nw-dock-w:7.7em;--nw-dock-h:40px;}
.nw-dock-menu .nw-dock-btn:nth-child(5){--nw-dock-w:6.7em;--nw-dock-h:38px;}
.nw-dock-btn::before{
  content:'';position:absolute;inset:4px 0;z-index:-1;
  border-radius:calc(var(--nw-r-control) + 2px);
  pointer-events:none;
  /* R65：这张皮就是按钮的「实体」。纸色 + 4% 墨、一条 55% 的发丝边、贴地一点
     浮影——三个信号刚好够说「我是一个按钮」，又不至于在纸面上立成一排色块。 */
  background:var(--nw-dock-card);
  border:1px solid color-mix(in srgb, var(--nw-line-soft) 55%, transparent);
  box-shadow:0 1px 2px color-mix(in srgb, var(--nw-fg) 6%, transparent);
  transition:background .16s var(--nw-ease, ease),
    border-color .16s var(--nw-ease, ease),
    box-shadow .16s var(--nw-ease, ease);
}
/* 悬停：皮上铺一层品牌色薄雾，边界加深一点，浮影抬起来。
   不再画分隔线——按钮是分开的，线是同一块板上的东西。 */
.nw-dock-btn:hover:not([data-blocked="1"])::before,
.nw-dock-btn:focus-visible::before{
  background:linear-gradient(100deg,
    color-mix(in srgb, var(--nw-brand) 12%, var(--nw-dock-card)),
    color-mix(in srgb, var(--nw-brand) 5%, var(--nw-dock-card)));
  border-color:color-mix(in srgb, var(--nw-brand) 22%, transparent);
  box-shadow:0 2px 6px -1px color-mix(in srgb, var(--nw-brand) 18%, transparent);
}
.nw-dock-btn:active:not([data-blocked="1"])::before{filter:brightness(.97);}
.nw-dock-btn > *{pointer-events:none;}
/* 焦点环画在 ::before 上：按钮盒子是直角矩形，原生 outline 会在圆角高亮
   外面画出一个方框，看着像另一个控件。 */
.nw-dock-btn:focus-visible{outline:none;}
.nw-dock-btn:focus-visible::before{
  box-shadow:0 0 0 2px color-mix(in srgb, var(--nw-brand) 45%, transparent);
}
/* R58：没开章时不再是 disabled。禁用按钮一声不响，那和坏掉长得一样。 */
.nw-dock-btn[data-blocked="1"]{color:var(--nw-fg-soft);}
.nw-dock-btn[data-blocked="1"] .nw-dock-icon{opacity:.5;}
.nw-dock-btn[disabled]{cursor:default;}

/* 图标格：五个动作各有一枚自己的印记。静止时是浅墨底 + 发丝内描边，
   悬停时底换成品牌色渐变、描边加深、图标本身转成品牌色——变的是光，
   不是位置。尺寸由 --nw-dock-tile 给，窄屏跟着行高一起缩。 */
.nw-dock-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:var(--nw-dock-tile);height:var(--nw-dock-tile);flex:0 0 auto;
  border-radius:8px;
  background:color-mix(in srgb, var(--nw-fg) 5%, transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--nw-fg) 4%, transparent);
  color:color-mix(in srgb, var(--nw-fg-soft) 88%, var(--nw-fg));
  transition:background .16s var(--nw-ease, ease),
    color .16s var(--nw-ease, ease),
    box-shadow .16s var(--nw-ease, ease);
}
.nw-dock-btn:hover:not([data-blocked="1"]) .nw-dock-icon{
  background:linear-gradient(160deg,
    color-mix(in srgb, var(--nw-brand) 24%, transparent),
    color-mix(in srgb, var(--nw-brand) 11%, transparent));
  box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--nw-brand) 32%, transparent),
    0 1px 3px color-mix(in srgb, var(--nw-brand) 20%, transparent);
  color:var(--nw-brand);
}
.nw-dock-name{letter-spacing:.01em;font-weight:500;}

/* 圆钮（FAB）：盒子是方形、透明、无圆角；形状由 ::before 画。
   R65：用户要「单红色圆形」——于是这枚钮从印泥方钮退回成一枚**纯色正圆**：
   一种红（--nw-brand 原色，不掺墨也不做径向渐变）、一条 50% 的圆边、一条
   中性浮影。上一版的墨色、内圈发丝环、品牌色染影全部去掉，只留「一个圆」。
   盒子仍 52×52、border-radius:0、形状由 ::before 画——R56 起的不变式，碰
   外观不碰命中区。静止 .9，悬停与展开到 1。 */
.nw-dock-fab{
  position:relative;isolation:isolate;
  display:flex;align-items:center;justify-content:center;
  width:52px;height:52px;padding:0;flex:0 0 auto;
  border-radius:0;border:0;background:transparent;
  color:var(--nw-on-brand,#fff);
  cursor:pointer;
}
.nw-dock-fab::before{
  content:'';position:absolute;inset:0;z-index:-1;
  border-radius:50%;
  pointer-events:none;
  background:var(--nw-brand);
  box-shadow:
    0 8px 20px -8px color-mix(in srgb, var(--nw-brand) 60%, transparent),
    0 2px 6px -1px color-mix(in srgb, var(--nw-fg) 16%, transparent);
  opacity:.9;
  transition:opacity .2s var(--nw-ease, ease),
    box-shadow .2s var(--nw-ease, ease),
    filter .2s var(--nw-ease, ease);
}
.nw-dock-fab:hover::before,
.nw-dock-fab:focus-visible::before,
.nw-dock-fab[aria-expanded="true"]::before{opacity:1;}
.nw-dock-fab:active::before{filter:brightness(.95);}
.nw-dock-fab:focus-visible{outline:none;}
.nw-dock-fab:focus-visible::before{
  box-shadow:
    0 8px 20px -8px color-mix(in srgb, var(--nw-brand) 60%, transparent),
    0 2px 6px -1px color-mix(in srgb, var(--nw-fg) 16%, transparent),
    0 0 0 3px color-mix(in srgb, var(--nw-brand) 40%, transparent);
}
.nw-dock-fab > *{pointer-events:none;}
.nw-dock-fabicon{
  display:inline-flex;align-items:center;justify-content:center;
  width:20px;height:20px;
  transition:transform .22s var(--nw-ease-pop, ease);
}
.nw-dock-fab[aria-expanded="true"] .nw-dock-fabicon{transform:rotate(90deg);}

@media (prefers-reduced-motion: reduce){
  .nw-dock-menu,
  .nw-dock-menu[data-open="1"] .nw-dock-btn{animation:none;}
  .nw-dock-fab::before,.nw-dock-fab::after{transition:none;}
  .nw-dock-fabicon{transition:none;}
}

/* 灵感便签 (R13). R11 把它做成一整页纸：一展开就把正文顶掉，用户说「不用分窗口
   了，悬浮在编辑器上」，又说「看着好瘦长」—— 那是 196px 宽 × 整屏高 的结果。
   现在是一张 420×最多 320 的悬浮卡片，钉在写作列**左上角**：写作时一直看得见正文，
   关掉只留一枚小圆钮。整块不参与 .nw-main 的布局，所以永远不会把正文挤窄。 */
/* R24: 挪到左边。用户说「左侧没东西」—— 右边挤着修改建议栏和浮动坞，左边那片
   只有三个 28px 的角落按钮。放在 left:14px 还顺手解决了和查找栏的争位：查找栏
   占的是 top:10px right:14px，两者现在各占一角，谁都不用压谁。
   R28/R30: 早期版本让 .nw-bench-paper 用 padding-left 让出一条 348px 的车道，
   结果是卡片开着的瞬间纸面被挤窄、正文整体右移 —— 用户明确说不要这样。现在
   卡片是绝对定位的浮层，宽度直接取纸面左侧那段空白，纸面的宽度和位置都不依赖它。 */
.nw-notes{
  position:absolute;z-index:var(--nw-z-float);top:52px;left:14px;
  display:flex;flex-direction:column;align-items:flex-start;gap:var(--nw-sp-1);
  /* R30 ③: the width is exactly the empty margin beside the centred page, minus
     the 14px card offset and an 8px gap. That margin holds no glyph and no part
     of the paper, so the card sits *beside* the writing area instead of on it,
     and the page keeps both its measure and its position — nothing is pushed
     right, because this element is absolutely positioned and takes no space in
     the flex row.
     .nw-notes is absolutely positioned, so a percentage width alone is circular
     (it collapsed to 200px once) — the calc resolves against the paper box,
     which has a definite width. On a narrow panel the gutter shrinks to nothing
     and 98b-responsive drops the card to a compact corner overlay instead. */
  width:clamp(0px, calc((100% - min(var(--nw-page, 760px), 100%)) / 2 - 22px), 340px);
  min-width:0;
  pointer-events:none;
}
.nw-notes > *{pointer-events:auto;}
.nw-notes-tab{
  display:inline-flex;align-items:center;gap:var(--nw-sp-0);
  height:32px;padding:0 11px;border-radius:var(--nw-r-pill);
  /* R21: same story as the dock — host aliases plus a black shadow meant the
     tab ignored the reading theme entirely (a white pill floating on night).
     It now uses the palette's own panel/line/ink. */
  border:1px solid var(--nw-line-strong);
  background:var(--nw-panel);
  color:var(--nw-fg-soft);
  font-size:13px;cursor:pointer;opacity:.62;
  box-shadow:var(--nw-shadow-1);
  transition:opacity var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
             transform var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease),
             border-color var(--nw-dur,var(--nw-dur)) var(--nw-ease,ease);
}
.nw-notes-tab:hover,.nw-notes-tab:focus-visible{opacity:1;transform:translateY(-1px);border-color:var(--dsw-alias-border-l2);}
/* R27 ②: the tab used to fade to nothing once the card opened, which left the
   card with no visible way to close it — the only affordance was a hover-only
   button in the corner. The tab now stays as the collapse handle and sits just
   above the card, so "click to fold it away" is always reachable. */
.nw-notes-tab[aria-expanded="true"]{opacity:.72;}
.nw-notes-tab[aria-expanded="true"]:hover,
.nw-notes-tab[aria-expanded="true"]:focus-visible{opacity:1;}
.nw-notes-tab:focus-visible{opacity:1;}
.nw-notes-tabicon{display:inline-flex;align-items:center;justify-content:center;}
.nw-notes-tabtxt{white-space:nowrap;}
/* The card: paper, one hairline, one soft shadow. Deliberately not a full-bleed
   sheet — it floats, so it must read as an object placed *on* the manuscript.
   R16 ④: no header strip and no footer strip — the card is just paper and a
   textarea. The state word and the close button float over the top-right corner
   instead, so the note gets the whole card. */
.nw-notes-card{
  position:relative;
  /* R21: fills .nw-notes, which now carries the 420px ceiling. */
  width:100%;
  /* R14 ③: the card grows with the note instead of showing a fixed window —
     the textarea drives its own height, the card only caps how far it may go. */
  max-height:min(560px,calc(100vh - 200px));
  display:flex;flex-direction:column;min-height:0;
  border-radius:var(--nw-r-card);
  /* R21: host alias → palette token, so the card belongs to the reading theme. */
  border:1px solid var(--nw-line-strong);
  background:var(--nw-panel);
  box-shadow:var(--nw-shadow-3);
  overflow:hidden;
  animation:nw-notes-in var(--nw-dur) var(--nw-ease,ease);
}
@keyframes nw-notes-in{
  from{opacity:0;transform:translateY(-6px) scale(.985);}
  to{opacity:1;transform:none;}
}
/* Floating corner: state word + close. Fades in on hover/focus so it never
   competes with the text, but stays reachable for keyboard users. */
.nw-notes-tools{
  position:absolute;top:6px;right:6px;z-index:var(--nw-z-base);
  display:inline-flex;align-items:center;gap:4px;
  padding:2px 4px 2px 8px;border-radius:var(--nw-r-pill);
  background:color-mix(in srgb, var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base)) 88%, transparent);
  opacity:0;transition:opacity var(--nw-dur) ease;
}
.nw-notes-card:hover .nw-notes-tools,
.nw-notes-card:focus-within .nw-notes-tools{opacity:1;}
.nw-notes-state{font-size:var(--nw-fs-tiny);color:var(--dsw-alias-label-secondary);white-space:nowrap;opacity:.85;}
.nw-notes-input{
  flex:1 1 auto;width:100%;min-height:96px;box-sizing:border-box;
  border:none;outline:none;resize:none;background:transparent;
  color:var(--dsw-alias-label-primary);
  /* R16 ④: right padding clears the floating corner controls on the first line. */
  padding:12px 14px;
  font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",serif;
  font-size:15px;line-height:1.85;
  caret-color:var(--dsw-alias-brand-primary);
  /* R14 ③: height is set from scrollHeight on every change (auto-grow), so the
     textarea itself must never scroll — the card's own max-height governs. */
  overflow:hidden;
  transition:height var(--nw-dur) ease;
}
.nw-notes-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.65;}
@media (prefers-reduced-motion: reduce){
  .nw-notes-card{animation:none;}
  .nw-notes-tab{transition:none;}
  .nw-notes-tools{transition:none;}
}
.nw-root.nw-immersive{background:var(--dsw-alias-bg-base);}
.nw-root.nw-immersive .nw-main{flex:1 1 auto;}
`);

  const { useState, useEffect, useRef, useCallback, useMemo } = React;

  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(value));
    } catch (err) {
      /* private mode / quota — non fatal */
    }
    if (LS_PREF_KEYS.indexOf(key) >= 0) pushPrefsSoon();
  }

  function toast(message, kind) {
    if (NW.ui && NW.ui.toast) NW.ui.toast(message, kind);
  }

  function errText(err, fallback) {
    if (!err) return fallback || '操作失败';
    const msg = err && err.message ? String(err.message) : String(err);
    return msg || fallback || '操作失败';
  }

  // ------------------------------------------------------------ sidebar icon ---
  NW.SidebarIcon = function SidebarIcon(props) {
    const size = Number((props && props.size) || 16) || 16;
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        role: 'img',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('path', {
        d: 'M4 4.6A1.6 1.6 0 0 1 5.6 3H12v17.4H5.6A1.6 1.6 0 0 1 4 18.8V4.6Z',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M12 3h6.4A1.6 1.6 0 0 1 20 4.6v14.2a1.6 1.6 0 0 1-1.6 1.6H12',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M14.6 8.4c1.5-.5 2.7.6 2.2 2.1l-2.6 3.6-2.1.6.6-2.1 1.9-4.2Z',
        fill: 'currentColor',
        opacity: 0.85,
      }),
    );
  };

  // ------------------------------------------------------------------- App ----
  /**
   * One-shot typography migration.
   *
   * The editor used to ship 17px/1.9/720 as its defaults — too small to read
   * comfortably, which is exactly what users complained about. The defaults in
   * `NW.db.DEFAULT_SETTINGS` are now 19/2.0/760, but a stored settings row wins
   * over the defaults (`Object.assign` in loadAll), so every existing install
   * would keep the old cramped values forever. Bump the *old defaults* once per
   * browser and leave any other value untouched: if a user actually typed 17px
   * on purpose after the migration they keep it.
   *
   * @param {object} next  merged settings (mutated in place)
   * @param {object} stored raw row read from IndexedDB
   * @returns {object|null} patch to persist, or null when nothing changed
   */
  function migrateTypeScale(next, stored) {
    let marked = false;
    try {
      marked = lsGet(LS_TYPE_SCALE) === '1';
    } catch (err) {
      marked = true; // storage unavailable → never run, never thrash
    }
    if (marked) return null;
    const raw = stored && typeof stored === 'object' ? stored : {};
    const patch = {};
    // R3 defaults live in 10-db.js DEFAULT_SETTINGS: keep these targets equal to
    // it, otherwise an upgraded install would land on 19px while a fresh one
    // gets 20px for the same "default" setting. 19 is included because that was
    // the R2 default: users who already migrated once would otherwise stay there.
    if (Number(raw.fontSize) === 17 || Number(raw.fontSize) === 19) patch.fontSize = next.fontSize = 20;
    if (Number(raw.lineHeight) === 1.9 || Number(raw.lineHeight) === 190) patch.lineHeight = next.lineHeight = 2;
    if (Number(raw.pageWidth) === 720) patch.pageWidth = next.pageWidth = 760;
    try {
      lsSet(LS_TYPE_SCALE, '1');
    } catch (err) {
      /* ignore */
    }
    return Object.keys(patch).length ? patch : null;
  }

  /**
   * The reading themes were renamed in R3 (see docs/CONTRACT-R3.md §2):
   * light→claude, dark→night, parchment→ink, eye stays. Old installs carry the
   * legacy ids in settings, which no `[data-theme="…"]` block matches any more,
   * so the whole shell would fall back to unstyled tokens. This runs on every
   * load and is idempotent (new ids map to themselves).
   *
   * @param {object} next merged settings (mutated in place)
   * @returns {object|null} patch to persist, or null when nothing changed
   */
  function migrateTheme(next) {
    // R19 dropped four palettes. Anything stored under an id that no longer
    // exists has to land on a survivor, otherwise 60-editor.js falls back to
    // claude on its own while the swatch row shows nothing selected.
    const map = {
      light: 'claude',
      harness: 'claude',
      card: 'claude',
      dark: 'night',
      ink: 'night',
      parchment: 'night',
      guofeng: 'newspaper',
      paper: 'newspaper',
    };
    const current = String((next && next.theme) || '');
    const mapped = map[current];
    if (!mapped) return null;
    next.theme = mapped;
    return { theme: mapped };
  }

  NW.App = function App() {
    const [ready, setReady] = useState(false);
    const [bootError, setBootError] = useState('');
    const [novels, setNovels] = useState([]);
    const [chapters, setChapters] = useState([]);
    // R47: the writer's annotations for the whole library. Marks belong to a
    // chapter, and the reading view shows a whole book at a time, so the shell
    // keeps them all and lets the view pick the ones it needs — one store read
    // instead of one per chapter.
    const [marks, setMarks] = useState([]);
    const [settings, setSettings] = useState(() => NW.db.DEFAULT_SETTINGS || {});
    const [activeNovelId, setActiveNovelId] = useState(null);
    const [activeChapterId, setActiveChapterId] = useState(null);
    const [chapter, setChapter] = useState(null);
    const [saveState, setSaveState] = useState('saved');
    const [savedAt, setSavedAt] = useState(0);
    /**
     * Set when the editor reports an edit while a write is in flight.
     *
     * The write only knows about the text it was handed; anything typed after
     * that is still in the textarea. Without this flag the completion handler
     * announced "已保存" and the status line claimed the cursor was persisted
     * while the last sentence was not.
     */
    const dirtyDuringSaveRef = useRef(false);
    const [selection, setSelection] = useState(null);
    const [shelfWidth, setShelfWidth] = useState(() => {
      const raw = Number(lsGet(LS_WIDTH));
      return Number.isFinite(raw) && raw >= 220 && raw <= 720 ? raw : DEFAULT_WIDTH;
    });
    const [dialog, setDialog] = useState(null);
    const [modalReq, setModalReq] = useState(null);
    const [modelPicker, setModelPicker] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [locked, setLocked] = useState(false);
    const [busy, setBusy] = useState('');
    const [caps, setCaps] = useState({ docx: true, epub: true, pdf: true, txt: true });
    const [immersive, setImmersive] = useState(false);
    const [library, setLibrary] = useState({ dir: '', mirror: false, encrypt: false, lastMirrorAt: 0, dirExists: false });
    /**
     * LAN sync (R34). `books` is what the host mirror currently holds and
     * `lastPushAt` when this browser last handed its library over — shown in the
     * pairing dialog so "is it actually syncing?" has an answer visible on screen.
     */
    const [lanSync, setLanSync] = useState({ books: 0, lastPushAt: 0, pulledAt: 0, pulled: 0, peers: 0, lastSyncAt: 0, lan: null, stats: null });
    /** Studio's own sidebar (the chapter tree) can be hidden independently of the host rail. */
    const [shelfOpen, setShelfOpen] = useState(() => lsGet(LS_SHELF_OPEN) !== '0');
    /**
     * 修改建议 column (R12 ②). Off by default: it costs a model call and most
     * sessions are spent writing, not reviewing.
     */
    const [adviceOpen, setAdviceOpen] = useState(() => lsGet(LS_ADVICE_OPEN) === '1');
    /**
     * R60: the dock is collapsed by default. R57 had no such state because the
     * five rows were always laid out; now that the shape is a FAB again, this is
     * what the button toggles. Not persisted on disk on purpose — a dock that
     * reopens itself on restart would cover the last paragraphs of the chapter.
     *
     * R85: clicking anywhere outside the expanded dock collapses it, and Esc
     * does the same. The root node is kept in a ref so "outside" means "not one
     * of these five rows or the FAB", not "the host re-rendered the slot".
     */
    const [dockOpen, setDockOpen] = useState(false);
    const dockRef = useRef(null);
    /**
     * R25: null = auto. The column measures itself from the bench (see
     * .nw-suggest in the CSS above) so it always hugs the page instead of
     * leaving a dead margin. A drag stores an explicit pixel width and from then
     * on that wins, until the writer resets it.
     */
    const [adviceWidth, setAdviceWidth] = useState(() => {
      const raw = Number(lsGet(LS_ADVICE_WIDTH));
      return Number.isFinite(raw) && raw >= 260 && raw <= 640 ? raw : null;
    });
    /**
     * R73: 选中改写 — the window opened by the little button that appears when
     * words are selected. Holds `{start, end, text}` frozen at the click, so the
     * window keeps describing the same passage even after the selection itself
     * is gone.
     */
    const [selAdvice, setSelAdvice] = useState(null);
    /**
     * R73: 已接收的修改建议 for the whole library (rows are per chapter; the open
     * chapter's slice is derived below). Loaded once on boot and refreshed
     * whenever a decision is made — the same list feeds the dock's column and the
     * selection window, so accepting in one place shows up in the other.
     */
    const [revisions, setRevisions] = useState([]);
    const revisionsRef = useRef(revisions);
    revisionsRef.current = revisions;
    /**
     * R77: 「今天写了多少」 —— 按天的净字数，落在 settings.dailyStats 里
     * （`{ 'YYYY-MM-DD': number }`）。不算别的：切换章节时编辑器会 flush，
     * 一次 flush 的字数差就是这一笔。
     */
    const [dailyStats, setDailyStats] = useState({});
    const dailyStatsRef = useRef(dailyStats);
    dailyStatsRef.current = dailyStats;
    const dailyWordsRef = useRef({});
    const dailyTimerRef = useRef(0);
    /**
     * R78: 增量保存的状态。`mirrorSeenRef` 记「上次成功写盘时每本书长什么样」，
     * 每次自动保存只把变过的那几本报给宿主；空 Map（本会话第一次）或加密开关
     * 变化时退回整库重写。
     */
    const mirrorSeenRef = useRef(new Map());
    const mirrorEncryptRef = useRef(null);
    /** R81: last mirrored note/submission signatures (they are snapshot-only). */
    const mirrorMetaRef = useRef({ note: '', submission: '' });
    /**
     * R77 (B2): 跟随系统深浅色。`prefers-color-scheme` 是唯一可靠的信号；
     * 老浏览器没有 matchMedia 时永远算「亮」，行为退回手动主题。
     */
    const [systemDark, setSystemDark] = useState(() => {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      } catch (err) {
        return false;
      }
    });
    useEffect(() => {
      if (typeof window.matchMedia !== 'function') return undefined;
      let mq = null;
      try {
        mq = window.matchMedia('(prefers-color-scheme: dark)');
      } catch (err) {
        return undefined;
      }
      const onChange = (ev) => setSystemDark(!!(ev && ev.matches));
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      return () => {
        if (mq.removeEventListener) mq.removeEventListener('change', onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
      };
    }, []);
    /**
     * R44: 读一遍 — the whole book laid out as pages, over the writing surface.
     * It is an overlay rather than a route on purpose: the editor stays mounted
     * underneath, so the caret, the scroll position and any unsaved buffer are
     * exactly where the writer left them when they close it.
     */
    const [readOpen, setReadOpen] = useState(false);
    /**
     * 灵感便签 (R10): notes for the open book, plus whether the card is up.
     * R13 turned it into a floating card anchored to the corner of the paper
     * (see the Notes component): it never reserves a lane, never covers the
     * line being typed, and collapses to a single round button.
     */
    const [notesOpen, setNotesOpen] = useState(() => lsGet(LS_NOTES_OPEN) === '1');
    const [notes, setNotes] = useState([]);
    /** R14 ③: the open chapter's note, kept here so the card can render at once. */
    const [noteText, setNoteText] = useState('');
    /**
     * Which screen the main column shows. R5 opens on the welcome screen —
     * picking a chapter (or 继续写作) switches to the editor. The editor stays
     * mounted only while `view === 'write'`, so returning home flushes the buffer
     * through the editor's own unmount save path.
     */
    const [view, setView] = useState('home');
    /** Feed for the welcome screen's 投稿记录 card (loaded best-effort on boot). */
    const [submissions, setSubmissions] = useState([]);
    const [journalCount, setJournalCount] = useState(0);
    /**
     * Inbox (编辑部回信). Kept separate from `submissions` because it is a live
     * network read: `status:'idle'|'loading'|'ok'|'error'`, and a failure must
     * never look like "没有回信".
     */
    const [inbox, setInbox] = useState({
      status: 'idle',
      messages: [],
      total: 0,
      unseen: 0,
      configured: false,
      error: '',
      hint: '',
      at: 0,
    });

    const editorRef = useRef(null);
    const rootRef = useRef(null);
    const aliveRef = useRef(true);
    /** R82: last chapter-open request; a slower earlier open must not win. */
    const chapterOpenSeqRef = useRef(0);
    // R34: the latest inbox page, read by `refreshHomeFeed` to reconcile the
    // submission log without taking `inbox` into its dependency list.
    const inboxRef = useRef(inbox);
    inboxRef.current = inbox;
    // Set once a silent (autosave) mirror fails, so the user sees the error
    // once instead of on every keystroke-triggered retry.
    const mirrorFailedRef = useRef(false);
    const lastTouchRef = useRef(0);
    const versionRef = useRef({ chapterId: null, at: 0 });
    const chapterRef = useRef(null);
    chapterRef.current = chapter;
    const immersiveRef = useRef(false);
    immersiveRef.current = immersive;
    // R43 ④: `pullSync` must not close over `novels`. Every keystroke that lands
    // in the library calls setNovels, which used to invalidate the callback and
    // rebuild the 6s interval — the timer restarted before it ever fired, so a
    // phone edit could sit in the mirror for as long as the user kept typing.
    // Read the list through a ref instead and keep the dependency list empty.
    const novelsRef = useRef([]);
    novelsRef.current = novels;
    // Same reason: adopting a remote chapter is only safe when the buffer has
    // nothing unsaved in it.
    const saveStateRef = useRef('saved');
    saveStateRef.current = saveState;

    // ------------------------------------------------------------- toasts ----
    /**
     * R22: toasts can carry one action (撤销). Returns the toast id so callers
     * can dismiss it early, and action toasts live longer — 2.8s is not enough
     * time to notice and hit undo.
     */
    const pushToast = useCallback((message, kind, action) => {
      const id = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
      const row = { id: id, message: String(message), kind: kind || 'info' };
      if (action && typeof action.onClick === 'function') {
        row.actionLabel = String(action.label || '撤销');
        row.onClick = action.onClick;
      }
      setToasts((list) => list.concat([row]));
      const ttl = row.actionLabel ? 6000 : 2800;
      setTimeout(() => {
        if (!aliveRef.current) return;
        setToasts((list) => list.filter((item) => item.id !== id));
      }, ttl);
      return id;
    }, []);

    useEffect(() => {
      NW.uiToastBus.push = pushToast;
      return () => {
        if (NW.uiToastBus.push === pushToast) NW.uiToastBus.push = null;
      };
    }, [pushToast]);

    const dismissToast = useCallback((id) => {
      setToasts((list) => list.filter((row) => row.id !== id));
    }, []);

    useEffect(() => {
      NW.uiModalHost.request = (req) => setModalReq(req);
      return () => {
        NW.uiModalHost.request = null;
      };
    }, []);

    /*
     * R34: `NW.ai.*Safe` needs a place to ask "which model instead?" when every
     * configured provider failed. It cannot render a dialog itself (it lives in
     * 30-io, which has no React), so the shell installs this hook and the
     * dialog below collects the answer.
     *
     * Resolving `null` means "cancel": the caller then rethrows the original
     * error, so a writer who dismisses the picker still sees why it failed.
     */
    useEffect(() => {
      NW.askModel = (input) =>
        new Promise((resolve) => {
          setModelPicker({ req: input || {}, resolve: resolve });
        });
      return () => {
        NW.askModel = null;
      };
    }, []);

    useEffect(() => {
      aliveRef.current = true;
      return () => {
        aliveRef.current = false;
      };
    }, []);

    // ------------------------------------------------------- data loading ----
    const loadAll = useCallback(async () => {
      await NW.db.init();
      const [novelRows, chapterRows, storedRaw, markRows, revisionRows] = await Promise.all([
        NW.db.listNovels(),
        NW.db.listChapters(),
        NW.db.getSettings(),
        NW.db.listMarks ? NW.db.listMarks() : [],
        NW.db.listRevisions ? NW.db.listRevisions() : [],
      ]);
      if (!aliveRef.current) return null;
      // R80: a wiped WebView profile leaves IndexedDB empty, so `getSettings()`
      // silently answers with the defaults. The host keeps a copy under DSH_HOME;
      // adopt it only when this profile has no settings row at all, so a live
      // profile's own choices always win.
      let stored = storedRaw;
      try {
        const hasLocal = typeof NW.db.hasSettings === 'function' ? await NW.db.hasSettings() : true;
        if (!hasLocal && NW.io && NW.io.client && typeof NW.io.client.state === 'function') {
          const host = await NW.io.client.state();
          if (host && host.settings && typeof host.settings === 'object') {
            stored = Object.assign({}, host.settings);
            await NW.db.saveSettings(stored);
          }
        }
      } catch (err) {
        /* a missing host copy must never block opening the studio */
      }
      const nextSettings = Object.assign({}, NW.db.DEFAULT_SETTINGS || {}, stored || {});
      const migrated = migrateTypeScale(nextSettings, stored);
      const themePatch = migrateTheme(nextSettings);
      const persistence = Object.assign({}, migrated || {}, themePatch || {});
      if (Object.keys(persistence).length) {
        // Persist in the background: the in-memory values are already correct,
        // and a failed write must never block opening the studio.
        NW.db.saveSettings(persistence).catch(() => {});
      }
      setNovels(Array.isArray(novelRows) ? novelRows : []);
      setChapters(Array.isArray(chapterRows) ? chapterRows : []);
      setMarks(Array.isArray(markRows) ? markRows : []);
      setRevisions(Array.isArray(revisionRows) ? revisionRows : []);
      setSettings(nextSettings);
      // R77: 今日字数 / 连续天数从这里起步；老库没有这个键就是一本空账。
      setDailyStats(nextSettings.dailyStats && typeof nextSettings.dailyStats === 'object' ? nextSettings.dailyStats : {});
      // R80: seed / refresh the host copy so a later reinstall can restore it.
      pushSettingsSoon();
      return { novels: novelRows || [], chapters: chapterRows || [], settings: nextSettings };
    }, []);

    const pickInitial = useCallback((data) => {
      const list = Array.isArray(data.chapters) ? data.chapters : [];
      const novelRows = Array.isArray(data.novels) ? data.novels : [];
      const wantChapter = lsGet(LS_CHAPTER);
      const wantNovel = lsGet(LS_NOVEL);
      let nextChapter = null;
      if (wantChapter) {
        for (let i = 0; i < list.length; i += 1) {
          if (list[i] && String(list[i].id) === String(wantChapter)) {
            nextChapter = list[i];
            break;
          }
        }
      }
      if (!nextChapter && list.length) nextChapter = list[0];
      let nextNovelId = null;
      if (nextChapter) nextNovelId = nextChapter.novelId;
      else if (wantNovel) {
        for (let i = 0; i < novelRows.length; i += 1) {
          if (novelRows[i] && String(novelRows[i].id) === String(wantNovel)) {
            nextNovelId = novelRows[i].id;
            break;
          }
        }
      }
      if (nextNovelId == null && novelRows.length) nextNovelId = novelRows[0].id;
      return { chapter: nextChapter, novelId: nextNovelId };
    }, []);

    const boot = useCallback(async () => {
      try {
        // R80: a host reinstall can replace the WebView profile, which is where
        // localStorage (password verifier + layout prefs) and IndexedDB (books,
        // settings) live. The host keeps a copy of the small pieces under
        // DSH_HOME; pull them back before deciding anything about locking.
        if (NW.crypto && typeof NW.crypto.hydrate === 'function') await NW.crypto.hydrate();
        await hydratePrefs();
        // Whether the studio starts locked is decided by the key, not by the
        // persisted flag: the derived key only ever lives in memory, so any
        // reload/restart loses it. Trusting `nw.locked` here would boot the
        // editor with an empty buffer (ciphertext cannot be opened), and the
        // next autosave would overwrite the book with ''. So: a password plus
        // a cold key always means "locked".
        const hasPw = NW.crypto && NW.crypto.hasPassword ? await NW.crypto.hasPassword() : false;
        const isLocked = hasPw && !(NW.crypto.isUnlocked && NW.crypto.isUnlocked());
        if (isLocked) {
          if (NW.crypto.lock) NW.crypto.lock();
          setLocked(true);
          setReady(true);
          return;
        }
        const data = await loadAll();
        if (!data) return;
        const initial = pickInitial(data);
        setActiveNovelId(initial.novelId == null ? null : initial.novelId);
        setActiveChapterId(initial.chapter ? initial.chapter.id : null);
        setChapter(initial.chapter || null);
        // R22: land back on the screen the writer left (only if it still makes
        // sense — 写作 needs a chapter, so an empty library stays on 首页).
        if (lsGet(LS_VIEW) === 'write' && initial.chapter) setView('write');
        setSaveState('saved');
        setReady(true);
      } catch (err) {
        setBootError(errText(err, '初始化失败'));
        setReady(true);
      }
    }, [loadAll, pickInitial]);

    useEffect(() => {
      boot();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * R16 ⑥: push the 标点 setting into NW.format before anything counts words.
     * wordCount() reads it as its default, so this one effect keeps the status
     * bar, the book totals and every recomputed chapter count in agreement.
     */
    useEffect(() => {
      if (NW.format && typeof NW.format.setCountPunctuation === 'function') {
        NW.format.setCountPunctuation(settings.countPunctuation !== false);
      }
    }, [settings.countPunctuation]);

    // Reflect active ids to localStorage — but never before boot() has restored
    // them, and never while locked. On the very first render both ids are null,
    // and an unguarded write erased `nw.activeChapter` before pickInitial() could
    // read it, so every reload/restart (and every unlock) jumped back to chapter 1.
    useEffect(() => {
      if (!ready || locked) return;
      lsSet(LS_NOVEL, activeNovelId == null ? null : activeNovelId);
    }, [activeNovelId, ready, locked]);
    useEffect(() => {
      if (!ready || locked) return;
      lsSet(LS_CHAPTER, activeChapterId == null ? null : activeChapterId);
    }, [activeChapterId, ready, locked]);
    /**
     * R22: per-book "last chapter" memory. `nw.activeChapter` only covers the
     * book that happens to be open, so switching to another book and back used
     * to lose your place. One small JSON map is enough.
     */
    useEffect(() => {
      if (!ready || locked) return;
      if (activeNovelId == null || activeChapterId == null) return;
      let map = {};
      try {
        map = JSON.parse(lsGet(LS_LAST_CHAPTER) || '{}') || {};
      } catch (err) {
        map = {};
      }
      if (map[String(activeNovelId)] === String(activeChapterId)) return;
      map[String(activeNovelId)] = String(activeChapterId);
      lsSet(LS_LAST_CHAPTER, JSON.stringify(map));
    }, [activeNovelId, activeChapterId, ready, locked]);
    useEffect(() => {
      lsSet(LS_WIDTH, shelfWidth);
    }, [shelfWidth]);
    useEffect(() => {
      lsSet(LS_SHELF_OPEN, shelfOpen ? '1' : '0');
    }, [shelfOpen]);
    useEffect(() => {
      lsSet(LS_NOTES_OPEN, notesOpen ? '1' : '0');
    }, [notesOpen]);
    useEffect(() => {
      lsSet(LS_ADVICE_OPEN, adviceOpen ? '1' : '0');
      // R83: the column owns the right lane; a floating dock on top of it both
      // covers suggestions and steals the close click. Whatever opened the
      // column (dock row, shortcut, restored session), collapse the dock.
      if (adviceOpen) setDockOpen(false);
    }, [adviceOpen, setDockOpen]);
    /**
     * R85: an expanded dock is a popover — the next click that misses it puts
     * it away. Capture phase on purpose: the click that opens a dialog or
     * switches screens should close the menu *before* that screen arrives, so
     * the menu never floats over the thing the writer just asked for. A click
     * on one of the five rows is a hit and keeps its own handler in charge.
     */
    useEffect(() => {
      if (!dockOpen) return undefined;
      const onPointerDown = (event) => {
        const node = dockRef.current;
        if (node && event.target && node.contains(event.target)) return;
        setDockOpen(false);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) setDockOpen(false);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
      };
    }, [dockOpen]);
    useEffect(() => {
      /* null means auto — clear the key so a fresh session keeps measuring. */
      lsSet(LS_ADVICE_WIDTH, adviceWidth == null ? null : adviceWidth);
    }, [adviceWidth]);
    /**
     * R23: opening the advice column takes the 目录 down with it.
     *
     * The bench is a three-way split (shelf | paper | advice) and the paper is
     * what the comparison is about — a 272px tree plus a 336px column on a
     * ~1200px panel leaves the manuscript about 550px, at which point the
     * suggestion and the sentence it quotes are no longer side by side but one
     * above the other. The shelf is collapsed for as long as the column is
     * open, and put back afterwards only if the writer had it open to begin
     * with (closing the column must not resurrect a shelf they had hidden).
     */
    const shelfBeforeAdvice = useRef(null);
    useEffect(() => {
      if (adviceOpen) {
        if (shelfBeforeAdvice.current == null) shelfBeforeAdvice.current = shelfOpen;
        if (shelfOpen) setShelfOpen(false);
        return;
      }
      if (shelfBeforeAdvice.current === true) setShelfOpen(true);
      shelfBeforeAdvice.current = null;
      // `shelfOpen` is read once on the open edge on purpose: depending on it
      // would re-collapse the shelf the moment the writer reopens it by hand
      // while the column is up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adviceOpen]);
    /**
     * R73: the selection window is about one passage of one chapter. Switching
     * chapters (or leaving the writing screen) must not leave it open quoting
     * text that is no longer on the paper.
     */
    useEffect(() => {
      setSelAdvice(null);
    }, [chapter && chapter.id, view]);
    /**
     * R22: remember which screen you were on. Booting straight into 首页 every
     * time meant a writer who had been in the editor all afternoon reopened the
     * studio and had to click their chapter again. Only restored once the boot
     * has picked a chapter, so 写作 is never shown with an empty canvas.
     */
    useEffect(() => {
      if (!ready || locked) return;
      if (view === 'write' && !chapter) return;
      lsSet(LS_VIEW, view);
    }, [view, ready, locked, chapter]);

    /**
     * Home-screen data: the submission log and the journal count. Both are
     * host-side reads that may simply not exist on an older host half, so every
     * failure is swallowed — the welcome screen just shows empty states.
     */
    const refreshHomeFeed = useCallback(async () => {
      try {
        // R34: hand the host whatever the inbox last delivered so it can derive
        // 「等待回复」 from a real reply instead of guessing. The state is a
        // closure read, so this stays out of the dependency list — a new inbox
        // page does not need to rebuild refreshHomeFeed.
        const known = inboxRef.current && Array.isArray(inboxRef.current.messages) ? inboxRef.current.messages : [];
        const data = await NW.io.submit.record({ replies: known.length ? known : undefined });
        if (!aliveRef.current) return;
        setSubmissions(Array.isArray(data && data.records) ? data.records : []);
      } catch (err) {
        /* older host half: no submit.record */
      }
      try {
        const data = await NW.io.journals.list();
        if (!aliveRef.current) return;
        setJournalCount(Array.isArray(data && data.journals) ? data.journals.length : 0);
      } catch (err) {
        /* older host half: no journals.list */
      }
    }, []);

    /**
     * Read the newsgroup inbox. An IMAP round trip takes seconds, so this is
     * never awaited by the UI: the card renders `status` while it runs. The host
     * answers `configured:false` (not an error) when no mailbox is set up, which
     * keeps "还没配置" apart from "连不上".
     */
    const refreshInbox = useCallback(async () => {
      if (!(NW.io && NW.io.inbox && NW.io.inbox.list)) return;
      setInbox((prev) => Object.assign({}, prev, { status: 'loading' }));
      try {
        const data = await NW.io.inbox.list({ limit: 12 });
        if (!aliveRef.current) return;
        setInbox({
          status: 'ok',
          messages: Array.isArray(data && data.messages) ? data.messages : [],
          total: Number(data && data.total) || 0,
          unseen: Number(data && data.unseen) || 0,
          configured: !!(data && data.configured),
          enabled: !!(data && data.enabled),
          error: String((data && data.error) || ''),
          hint: String((data && data.hint) || ''),
          at: Date.now(),
        });
        // R34: the submission card derives 「等待回复」 from this very page, so a
        // fresh inbox means the log's statuses are now stale. `refreshHomeFeed`
        // reads `inboxRef`, which is assigned during render — one tick later.
        const page = Array.isArray(data && data.messages) ? data.messages : [];
        if (page.length) {
          try {
            const logged = await NW.io.submit.record({ replies: page });
            if (aliveRef.current && Array.isArray(logged && logged.records)) {
              setSubmissions(logged.records);
            }
          } catch (ignored) {
            /* older host half: no submit.record */
          }
        }
      } catch (err) {
        if (!aliveRef.current) return;
        setInbox((prev) =>
          Object.assign({}, prev, {
            status: 'error',
            error: err && err.message ? String(err.message) : '读取收件箱失败',
            hint: '',
            at: Date.now(),
          }),
        );
      }
    }, []);

    useEffect(() => {
      if (!ready || locked) return;
      refreshHomeFeed();
      refreshInbox();
    }, [ready, locked, refreshHomeFeed, refreshInbox]);

    /**
     * R16 ⑤: drop one mail from the mailbox, then re-read the box so the unread
     * badge and the row count come from the server instead of being guessed.
     */
    const deleteMail = useCallback(
      async (row) => {
        const uid = Number(row && row.uid) || 0;
        if (!uid) {
          pushToast('这封邮件没有编号，无法删除', 'error');
          return;
        }
        const ok = await NW.ui.confirm('删除这封邮件？删除后需要到你自己的邮箱里才能找回。', {
          title: '删除邮件',
          danger: true,
          okText: '删除',
        });
        if (!ok) return;
        try {
          const data = await NW.io.inbox.remove(uid);
          if (data && data.deleted === false) {
            pushToast(String(data.error || '删除这封邮件失败'), 'error');
            return;
          }
          if (data && data.hint) pushToast(String(data.hint), 'info');
          else pushToast('已删除这封邮件', 'ok');
        } catch (err) {
          pushToast(errText(err, '删除这封邮件失败'), 'error');
          return;
        }
        await refreshInbox();
      },
      [pushToast, refreshInbox],
    );

    // Library folder (host-side on-disk mirror). Best effort: an older host
    // half without lib/library.js answers `unknown-method`, which must not
    // surface as a startup error.
    const refreshLibrary = useCallback(async () => {
      try {
        const data = await NW.io.library.get();
        if (!aliveRef.current || !data) return;
        setLibrary({
          dir: String(data.dir || ''),
          mirror: data.mirror === true,
          encrypt: data.encrypt === true,
          lastMirrorAt: Number(data.lastMirrorAt) || 0,
          dirExists: data.dirExists !== false,
        });
      } catch (err) {
        /* host half may not support library.* — stay quiet */
      }
    }, []);

    useEffect(() => {
      if (!ready || locked) return;
      refreshLibrary();
    }, [ready, locked, refreshLibrary]);

    /**
     * 灵感便签 (R10, reworked in R14 ③): the card now belongs to the open
     * chapter. `noteText` keeps the chapter's own draft, so switching chapters
     * shows a different card instead of one growing blob for the whole book.
     */
    const refreshNotes = useCallback(async () => {
      try {
        const activeId = (chapterRef.current && chapterRef.current.id) || '';
        const rows = await NW.db.listNotes(activeNovelId || '', activeId);
        if (!aliveRef.current) return;
        const list = Array.isArray(rows) ? rows : [];
        setNotes(list);
        setNoteText(list.length > 0 ? String(list[0].text || '') : '');
      } catch (err) {
        if (aliveRef.current) {
          setNotes([]);
          setNoteText('');
        }
      }
    }, [activeNovelId]);

    useEffect(() => {
      if (!ready || locked) return;
      refreshNotes();
      // R14 ③: notes follow the chapter, so switching chapters must reload the
      // card. Keyed on the id (not the object) so a save that returns a new
      // chapter object with the same id does not blank the card mid-typing.
    }, [ready, locked, refreshNotes, chapter && chapter.id]);

    /**
     * R14 ③: the note card autosaves on every keystroke (debounced), so there is
     * no 保存 step any more. One row per chapter — the text is replaced, not
     * appended, and clearing the box deletes the row.
     */
    const saveNotes = useCallback(
      async (text, chapterId) => {
        try {
          // R14 ③: the caller passes the chapter the text was typed in. Reading
          // it from `chapterRef` here would file the last keystrokes of chapter
          // A under chapter B when the user switches before the debounce fires.
          const targetId = chapterId != null ? String(chapterId) : (chapterRef.current && chapterRef.current.id) || '';
          if (!targetId) return;
          await NW.db.saveChapterNote({
            novelId: activeNovelId || '',
            chapterId: targetId,
            text: String(text == null ? '' : text),
          });
          // Only refresh the card if we are still looking at that chapter.
          if ((chapterRef.current && String(chapterRef.current.id)) === targetId) await refreshNotes();
        } catch (err) {
          pushToast('保存灵感失败', 'err');
        }
      },
      [activeNovelId, refreshNotes, pushToast],
    );

    /**
     * Write the whole library into the chosen folder. The host writes
     * `<dir>/<book>.docx` (or `.docx.nwe` when encryption is on) plus a
     * `library.json[.nwe]` snapshot that now carries chapters and settings too,
     * so the folder alone can restore everything.
     *
     * `{ silent: true }` is the autosave path: no toast on success, and a
     * failure is reported at most once per session so a broken folder never
     * spams the user while they are typing.
     */
    /**
     * R34 ④: the browser's library, in the shape the sync engine merges.
     *
     * Why the browser pushes at all: IndexedDB is the only place the real text
     * lives, and the host cannot read it. `sync.push` hands the host a full copy
     * on every library change, which is what lets a phone that comes online later
     * pull a complete, current library without the desktop having been idle.
     *
     * The unit is a *book* — `{id,title,author,updatedAt,deleted,chapters}` — and
     * `deleted` is only ever true for a book still sitting in the trash: that is
     * the tombstone, and without it a book deleted on the phone would reappear on
     * the next pull because the desktop simply had a copy of it.
     */
    const syncLibrary = useCallback(async () => {
      try {
        // Refuse to push while a password exists but the studio is locked: the
        // rows would be `enc:v1:` ciphertext, and the phone cannot read them. The
        // push effect already skips this state; the guard keeps a future caller
        // from reintroducing the bug the decryption below exists to fix.
        //
        // `hasPassword()` is async (15-crypto.js): reading it without `await`
        // used to make this guard true for everyone, because a Promise is always
        // truthy and `isUnlocked()` is false on an install that never set a
        // password. The result was no `sync.push` at all — the phone only ever
        // received what the phone itself had pushed.
        const hasPw = NW.crypto && typeof NW.crypto.hasPassword === 'function'
          ? await NW.crypto.hasPassword()
          : false;
        if (hasPw && !NW.crypto.isUnlocked()) return null;
        const snapshot = await NW.db.dump();
        const grouped = new Map();
        for (const row of snapshot.chapters || []) {
          if (!row || row.novelId == null) continue;
          if (!grouped.has(row.novelId)) grouped.set(row.novelId, []);
          grouped.get(row.novelId).push(row);
        }
        const books = (snapshot.novels || []).map((novel) => {
          const rows = (grouped.get(novel.id) || [])
            .slice()
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
          return {
            id: String(novel.id),
            title: String(novel.title || ''),
            author: String(novel.author || ''),
            updatedAt: Number(novel.updatedAt) || Number(novel.createdAt) || 0,
            deleted: novel.deleted === true,
            chapters: rows.map((row) => ({
              id: String(row.id),
              title: String(row.title || ''),
              content: String(row.content || ''),
              order: Number(row.order) || 0,
            })),
          };
        });
        // A book deleted here has to leave a tombstone, or a phone that was
        // offline during the deletion still holds a copy and hands it straight
        // back on its next push. The trash store already records every deleted
        // book (kind 'novel' plus the whole payload), so the tombstone is
        // derived from it rather than kept in a second bookkeeping store that
        // could drift out of step with the trash screen.
        const live = new Set(books.map((book) => book.id));
        for (const item of snapshot.trash || []) {
          if (!item || item.kind !== 'novel') continue;
          const gone = item.payload && item.payload.novel;
          if (!gone || gone.id == null) continue;
          const id = String(gone.id);
          if (live.has(id)) continue;
          books.push({
            id,
            title: String(gone.title || ''),
            author: String(gone.author || ''),
            // The deletion timestamp, not the book's: that is the moment the
            // merge has to compare against a peer's copy of the same book.
            updatedAt: Number(item.deletedAt) || 0,
            deleted: true,
            chapters: [],
          });
        }
        // R36: with 正文加密 on, IndexedDB stores `enc:v1:` bodies. Pushing them
        // raw is what made the phone show ciphertext: it holds no key and the
        // host only relays. This is the one place that can decrypt, so it does —
        // but only when the studio is unlocked, which `encryptionOn()` implies.
        // A body that fails to decrypt is left sealed rather than blanked:
        // showing a garbled chapter beats silently deleting it everywhere.
        if (await NW.crypto.encryptionOn()) {
          for (const book of books) {
            for (const chapter of book.chapters) {
              if (!chapter.content || !NW.crypto.isEncrypted(chapter.content)) continue;
              try {
                chapter.content = await NW.crypto.decryptText(chapter.content);
              } catch (err) {
                /* keep the ciphertext */
              }
            }
          }
        }
        const data = await NW.io.sync.push(books);
        if (!aliveRef.current) return data;
        setLanSync((prev) =>
          Object.assign({}, prev, {
            books: Number(data && data.books) || books.length,
            lastPushAt: Date.now(),
            stats: (data && data.stats) || prev.stats,
          })
        );
        return data;
      } catch (err) {
        // Sync is a background convenience: a failure must never surface as a
        // toast on every keystroke. The pairing dialog reports it on demand.
        return null;
      }
    }, [pushToast]);

    const mirrorLibrary = useCallback(async (options) => {
      const silent = !!(options && options.silent === true);
      // `override` lets the caller pass the settings it just persisted: the
      // state update that follows is asynchronous, so the closure still holds
      // the previous folder on the very first save after picking one.
      const cfg = (options && options.override) || library;
      if (!cfg.dir || cfg.mirror !== true) return null;
      try {
        const snapshot = await NW.db.dump();
        // R34: read the submission log from the host, not from React state — a
        // status changed in 投稿管理 may still be in flight when an autosave
        // fires, and the snapshot has to hold whatever is authoritative.
        let log = [];
        try {
          const logged = await NW.io.submit.record();
          log = Array.isArray(logged && logged.records) ? logged.records : [];
        } catch (err) {
          log = [];
        }
        const grouped = new Map();
        for (const row of snapshot.chapters || []) {
          if (!row || row.novelId == null) continue;
          if (!grouped.has(row.novelId)) grouped.set(row.novelId, []);
          grouped.get(row.novelId).push(row);
        }
        const payload = (snapshot.novels || []).map((novel, index) => {
          const rows = (grouped.get(novel.id) || [])
            .slice()
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
          return {
            // R78: the id is what makes an incremental save possible — the host
            // matches these against the books it must rewrite.
            id: novel.id != null ? String(novel.id) : '',
            title: novel.title || '未命名小说 ' + (index + 1),
            author: novel.author || '',
            chapters: rows.map((row, position) => ({
              title: row.title || '章节 ' + (position + 1),
              content: String(row.content || ''),
            })),
          };
        });
        const data = await NW.io.library.mirror({
          novels: payload,
          chapters: snapshot.chapters || [],
          settings: snapshot.settings || {},
          // R31 ③: the same snapshot restores chapters and notes together.
          notes: snapshot.notes || [],
          // R34: 投稿记录 travel with the book too. Statuses live on the host in
          // submissions.json, so they are read fresh here rather than trusted
          // from React state (a status changed in 投稿管理 may not have landed in
          // `submissions` yet).
          submissions: log,
          // R79: 标注 / 设定集 / 已接收建议 have to ride in the snapshot too. They
          // are small (a few rows per chapter), and without them "restore from
          // this folder" either dropped them (before R79 the restore cleared every
          // store) or could not bring them to a new machine. Version history and
          // the trash stay out on purpose: both can hold whole manuscripts, and a
          // snapshot is rewritten on every autosave. `replaceAll` now preserves
          // any store the snapshot does not mention, so leaving them out is safe.
          marks: snapshot.marks || [],
          lore: snapshot.lore || [],
          revisions: snapshot.revisions || [],
          encrypt: cfg.encrypt === true || settings.libraryEncrypt === true,
          // R78: undefined = 「整库重写」(first save of the session, encryption
          // toggled, or an old caller); an array = only these books changed.
          ...(Array.isArray(options && options.changed) ? { changed: options.changed } : {}),
        });
        if (!aliveRef.current) return data;
        setLibrary((prev) =>
          Object.assign({}, prev, {
            lastMirrorAt: Number(data && data.lastMirrorAt) || Date.now(),
            dirExists: true,
          })
        );
        mirrorFailedRef.current = false;
        if (!silent) {
          pushToast('已保存 ' + ((data && data.count) || 0) + ' 部小说到本地目录', 'ok');
        }
        return data;
      } catch (err) {
        if (silent) {
          if (!mirrorFailedRef.current) {
            mirrorFailedRef.current = true;
            pushToast(errText(err, '自动保存到本地目录失败'), 'error');
          }
          return null;
        }
        pushToast(errText(err, '保存到本地目录失败'), 'error');
        return null;
      }
    }, [pushToast, settings.libraryEncrypt, library.encrypt, library.dir, library.mirror]);

    /**
     * Autosave: every change to the library data (or the editor's live content)
     * re-writes the folder after a short idle window, so the on-disk file is
     * never more than a couple of seconds behind. Overwrites in place — there is
     * no growing list of dated backups.
     */
    const autosaveSignature = useMemo(() => {
      if (!library.dir || library.mirror !== true) return '';
      const novelPart = novels.map((row) => [row && row.id, row && row.updatedAt].join(':')).join(',');
      const chapterPart = chapters
        .map((row) => [row && row.id, row && row.updatedAt, row && row.wordCount].join(':'))
        .join(',');
      // R81: notes and submission statuses ride in the same snapshot (R78/R79),
      // but the signature ignored them, so "only edited a note" never rang the
      // bell and the folder kept an older copy. Both are small.
      const notePart = notes.map((row) => [row && row.id, row && row.updatedAt].join(':')).join(',');
      const submissionPart = submissions
        .map((row) => [row && row.id, row && (row.status || row.updatedAt || row.at)].join(':'))
        .join(',');
      return (
        novelPart + '|' + chapterPart + '|' + notePart + '|' + submissionPart
        + '|' + String(settings.libraryEncrypt === true)
      );
    }, [novels, chapters, notes, submissions, settings.libraryEncrypt, library.dir, library.mirror]);

    useEffect(() => {
      if (!ready || locked || !autosaveSignature) return undefined;
      const timer = window.setTimeout(() => {
        // R78: which books actually changed since the last successful mirror.
        const next = new Map();
        for (const row of novels) {
          if (row && row.id != null) next.set(String(row.id), 'n' + String(row.updatedAt || ''));
        }
        for (const row of chapters) {
          if (!row || row.novelId == null) continue;
          const key = String(row.novelId);
          next.set(
            key,
            (next.get(key) || '') + '|' + String(row.id) + ':' + String(row.updatedAt || '') + ':' + String(row.wordCount || 0),
          );
        }
        const seen = mirrorSeenRef.current;
        const encryptNow = settings.libraryEncrypt === true;
        const encryptChanged = mirrorEncryptRef.current !== encryptNow;
        // R81: notes / submissions are part of the snapshot but not of any book,
        // so they need their own signal. When only they move, `changed` is an
        // empty array and the host rewrites the snapshot without touching a docx.
        const noteSig = notes.map((row) => [row && row.id, row && row.updatedAt].join(':')).join(',');
        const submissionSig = submissions
          .map((row) => [row && row.id, row && (row.status || row.updatedAt || row.at)].join(':'))
          .join(',');
        const metaRef = mirrorMetaRef.current;
        const metaChanged = metaRef.note !== noteSig || metaRef.submission !== submissionSig;
        let changed = null;
        if (seen.size > 0 && !encryptChanged) {
          // R82: do not fall back to "rewrite every book" when the count changes.
          // An added book is simply in `changed`; a deleted one is handled by the
          // host's stale-name pass (it compares the previous snapshot with this
          // one on every call), which only needs a mirror call with an empty list.
          const bookCountChanged = next.size !== seen.size;
          changed = [];
          for (const [id, sig] of next) {
            if (seen.get(id) !== sig) changed.push(id);
          }
          // Nothing about any book, note or submission moved and no book appeared
          // or disappeared: the folder already holds exactly this library.
          if (changed.length === 0 && !metaChanged && !bookCountChanged) return;
        }
        const run = mirrorLibrary({ silent: true, changed: changed });
        if (run && typeof run.then === 'function') {
          run.then((ok) => {
            // Only a successful write may advance the baseline; a failed one
            // must leave every book "changed" so the next tick retries it.
            if (!ok) return;
            mirrorSeenRef.current = next;
            mirrorEncryptRef.current = encryptNow;
            mirrorMetaRef.current = { note: noteSig, submission: submissionSig };
          });
        }
      }, 1200);
      return () => window.clearTimeout(timer);
    }, [ready, locked, autosaveSignature, mirrorLibrary, novels, chapters, notes, submissions, settings.libraryEncrypt]);

    /**
     * R34 ④: hand the library to the host's sync mirror.
     *
     * Separate from `autosaveSignature` on purpose — the mirror is only active
     * when a folder has been chosen, while LAN sync should work for anyone who
     * paired a phone. It is debounced a little longer than the folder save
     * because the payload is the whole library and a phone pull is the only
     * consumer, so a 2s lag is invisible.
     */
    const syncSignature = useMemo(() => {
      const novelPart = novels.map((row) => [row && row.id, row && row.updatedAt].join(':')).join(',');
      const chapterPart = chapters
        .map((row) => [row && row.id, row && row.updatedAt, row && row.wordCount].join(':'))
        .join(',');
      return novelPart + '|' + chapterPart;
    }, [novels, chapters]);

    useEffect(() => {
      if (!ready || locked || !syncSignature) return undefined;
      const timer = window.setTimeout(() => {
        syncLibrary();
      }, 2000);
      return () => window.clearTimeout(timer);
    }, [ready, locked, syncSignature, syncLibrary]);

    /**
     * Poll for the phone's side.
     *
     * Lives next to `pullSync` at the bottom of the CRUD block, because the
     * dependency array is evaluated during render — naming `pullSync` up here
     * would read a `const` before it is initialised and take the whole panel down
     * with a ReferenceError.
     */
    // Host capabilities (drives which export formats the UI offers). Best effort:
    // when the host half is missing the defaults above keep every format listed and
    // the export itself surfaces the real error.
    useEffect(() => {
      if (!ready || locked) return;
      let alive = true;
      Promise.resolve()
        .then(() => NW.io.ping())
        .then((data) => {
          if (!alive || !data || !data.capabilities) return;
          setCaps((prev) => Object.assign({}, prev, data.capabilities));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [ready, locked]);

    // Which LAN addresses the phone can call. Read once per mount and after a
    // pairing code is generated; the listener itself is started host-side, so a
    // failure here just means the settings page shows "未启动".
    useEffect(() => {
      if (!ready || locked) return undefined;
      let alive = true;
      Promise.resolve()
        .then(() => NW.io.pair.info())
        .then((data) => {
          if (!alive || !data) return;
          // R38: keep the peers themselves, not just their count. The settings
          // page now shows "最近一次同步" for the phone, and only the host knows
          // when a phone last merged — this is the field that was always 0.
          setLanSync((prev) =>
            Object.assign({}, prev, {
              peers: Array.isArray(data.peers) ? data.peers.length : prev.peers,
              lastSyncAt: Array.isArray(data.peers) && data.peers.length ? data.peers.reduce((at, row) => Math.max(at, Number(row && row.lastSyncAt) || 0), 0) || prev.lastSyncAt : prev.lastSyncAt,
              lan: { running: data.running === true, port: Number(data.port) || 0, addresses: Array.isArray(data.addresses) ? data.addresses : [] },
            })
          );
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [ready, locked]);

    const patchChapterInList = useCallback((id, patch) => {
      setChapters((list) => {
        let hit = false;
        const next = list.map((row) => {
          if (!row || String(row.id) !== String(id)) return row;
          hit = true;
          return Object.assign({}, row, patch);
        });
        return hit ? next : list;
      });
    }, []);

    // ---- R77: 按天的字数账 ----------------------------------------------------
    // A local-date key. `toISOString()` would flip days at 08:00 Beijing time.
    const dayKeyOf = (ms) => {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };

    /** Write the ledger at most every couple of seconds — a save is every 1.2s. */
    const persistDailyStats = () => {
      if (dailyTimerRef.current) clearTimeout(dailyTimerRef.current);
      dailyTimerRef.current = window.setTimeout(() => {
        dailyTimerRef.current = 0;
        NW.db.saveSettings({ dailyStats: dailyStatsRef.current }).catch(() => {});
      }, 2000);
    };

    const bumpDailyWords = (delta) => {
      const value = Math.round(Number(delta) || 0);
      if (!value) return;
      const key = dayKeyOf(Date.now());
      const next = Object.assign({}, dailyStatsRef.current);
      next[key] = (Number(next[key]) || 0) + value;
      dailyStatsRef.current = next;
      setDailyStats(next);
      persistDailyStats();
    };

    const saveChapter = useCallback(
      async (content, chapterId) => {
        const current = chapterRef.current;
        // The text comes from an Editor that may already have been unmounted (its
        // flush runs while the next chapter is being opened), so the owning chapter
        // must travel with the call instead of being read from the current state.
        const targetId = chapterId != null ? chapterId : current && current.id;
        if (targetId == null) return;
        const text = content == null ? '' : String(content);
        setSaveState('saving');
        // Anything the editor reports from now on happened after this snapshot.
        dirtyDuringSaveRef.current = false;
        try {
          await NW.db.saveChapterContent(targetId, text);
          if (!aliveRef.current) return;
          const words = NW.format.wordCount(text);
          // R77: 今日字数 = this save's word delta. The first save of a chapter in
          // this session only records the baseline (no delta), so opening a book
          // never counts as writing it. Swings above 30k are restores or imports,
          // not typing — counting them would fake a heroic day.
          const prevWords = dailyWordsRef.current[String(targetId)];
          if (typeof prevWords === 'number') {
            const delta = words - prevWords;
            if (Math.abs(delta) <= 30000) bumpDailyWords(delta);
          }
          dailyWordsRef.current[String(targetId)] = words;
          setSaveState(dirtyDuringSaveRef.current ? 'dirty' : 'saved');
          setSavedAt(Date.now());
          patchChapterInList(targetId, { content: text, wordCount: words });
          // The write above is awaited, so the user may have switched chapters in the
          // meantime. Merge only if that chapter is still the one on screen, otherwise
          // the old chapter's text would be injected into the newly opened chapter.
          setChapter((prev) =>
            prev && String(prev.id) === String(targetId)
              ? Object.assign({}, prev, { content: text, wordCount: words })
              : prev,
          );
          const novelId = current && String(current.id) === String(targetId) ? current.novelId : null;
          if (novelId != null) {
            setNovels((list) =>
              list.map((n) => (n && String(n.id) === String(novelId) ? Object.assign({}, n, { updatedAt: Date.now() }) : n)),
            );
          }
        } catch (err) {
          if (!aliveRef.current) return;
          setSaveState('error');
          pushToast(errText(err, '保存失败'), 'error');
        }
      },
      [patchChapterInList, pushToast],
    );

    const flushEditor = useCallback(() => {
      const api = editorRef.current;
      if (api && typeof api.flush === 'function') {
        try {
          api.flush();
        } catch (err) {
          /* ignore */
        }
      }
    }, []);

    /**
     * Saves the current chapter as a version. Returns whether a snapshot was
     * actually written. Normal chapter switches are throttled to one per minute
     * so browsing does not flood the version list — but an explicit "restore
     * this version" or "create a snapshot" must force one, otherwise the text
     * being replaced can disappear without ever being recorded.
     */
    const snapshotVersion = useCallback(async (force) => {
      const current = chapterRef.current;
      if (!current || current.id == null) return false;
      let text = '';
      const api = editorRef.current;
      try {
        text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : String(current.content || '');
      } catch (err) {
        text = '';
      }
      const prev = versionRef.current;
      const sameChapter = prev.chapterId != null && String(prev.chapterId) === String(current.id);
      if (!force && sameChapter && Date.now() - prev.at < 60000) return false;
      if (!text.trim()) return false;
      try {
        await NW.db.saveVersion(current.id, text);
        versionRef.current = { chapterId: current.id, at: Date.now() };
        return true;
      } catch (err) {
        /* versions are best effort */
        return false;
      }
    }, []);

    // -------------------------------------------------- chapter selection ----
    const selectChapter = useCallback(
      async (id) => {
        if (id == null) return;
        if (activeChapterId != null && String(id) === String(activeChapterId)) return;
        // R82: two opens can be in flight (shelf search calls "select novel" and
        // "select chapter" back to back). The later request wins; an earlier one
        // that resolves afterwards must not steal the view.
        chapterOpenSeqRef.current += 1;
        const seq = chapterOpenSeqRef.current;
        flushEditor();
        await snapshotVersion();
        try {
          const record = await NW.db.getChapter(id);
          if (!aliveRef.current || chapterOpenSeqRef.current !== seq) return;
          if (!record) {
            pushToast('章节不存在或已被删除', 'error');
            return;
          }
          setActiveChapterId(record.id);
          setActiveNovelId(record.novelId == null ? null : record.novelId);
          setChapter(record);
          setSaveState('saved');
          setSelection(null);
          // Opening a chapter is the "continue writing" gesture: leave home.
          setView('write');
        } catch (err) {
          pushToast(errText(err, '打开章节失败'), 'error');
        }
      },
      [activeChapterId, flushEditor, snapshotVersion, pushToast],
    );

    const selectNovel = useCallback(
      async (id) => {
        setActiveNovelId(id == null ? null : id);
        if (id == null) return;
        const rows = chapters.filter((row) => row && String(row.novelId) === String(id));
        if (rows.length > 0) {
          // Switching books must move the editor too: the shelf already shows the new
          // book's tree, so leaving the previous book's chapter open would let the user
          // type into a chapter that is no longer listed (and no row would be selected).
          if (chapter && String(chapter.novelId) === String(id)) {
            // The book is already open: this call came from the home screen (or a
            // shelf click), so the only missing step is leaving home. Without this
            // the 正在创作 card looked dead whenever its book was the active one.
            setView('write');
            return;
          }
          // R22: reopening a book lands on the chapter you were last in, not on
          // its first chapter. Keeping the place is the difference between "my
          // book" and "a list of files".
          let resume = null;
          try {
            const map = JSON.parse(lsGet(LS_LAST_CHAPTER) || '{}') || {};
            const want = map[String(id)];
            if (want) resume = rows.find((row) => String(row.id) === String(want)) || null;
          } catch (err) {
            resume = null;
          }
          await selectChapter((resume || rows[0]).id);
          return;
        }
        // No chapters yet → create the first one so the editor is usable.
        if (String(chapter && chapter.novelId) === String(id)) {
          setView('write');
          return;
        }
        try {
          const created = await NW.db.createChapter(id, { title: NW.t('新章节') });
          if (!aliveRef.current || !created) return;
          const list = await NW.db.listChapters();
          if (!aliveRef.current) return;
          setChapters(list);
          setActiveChapterId(created.id);
          setChapter(created);
          setView('write');
        } catch (err) {
          pushToast(errText(err, '新建章节失败'), 'error');
        }
      },
      [chapters, chapter, selectChapter, pushToast],
    );

    // ------------------------------------------------- novel / chapter CRUD --
    const refreshChapters = useCallback(async () => {
      const list = await NW.db.listChapters();
      if (!aliveRef.current) return;
      setChapters(list);
      return list;
    }, []);

    const refreshNovels = useCallback(async () => {
      const list = await NW.db.listNovels();
      if (!aliveRef.current) return;
      setNovels(list);
      return list;
    }, []);

    const refreshMarks = useCallback(async () => {
      if (typeof NW.db.listMarks !== 'function') return [];
      const list = await NW.db.listMarks();
      if (!aliveRef.current) return [];
      setMarks(Array.isArray(list) ? list : []);
      return list;
    }, []);

    /** R73: re-read every accepted suggestion (the store is the source of truth). */
    const refreshRevisions = useCallback(async () => {
      if (typeof NW.db.listRevisions !== 'function') return [];
      const list = await NW.db.listRevisions();
      if (!aliveRef.current) return [];
      setRevisions(Array.isArray(list) ? list : []);
      return list;
    }, []);

    /**
     * R73: 接受一条修改建议.
     *
     * Writes ONE row and nothing else — the manuscript is the writer's, and
     * "accept" means "this edit is right, I will make it", not "apply it for me".
     * The offsets are located against the live buffer so the record points at
     * the words the card was quoting, even if the buffer is ahead of the save.
     */
    const acceptRevision = useCallback(
      async (draft) => {
        if (!draft || typeof NW.db.createRevision !== 'function') return null;
        const current = chapterRef.current;
        if (!current || current.id == null) return null;
        const api = editorRef.current;
        const text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
        const quote = String(draft.quote || '');
        let start = Math.round(Number(draft.start));
        let end = Math.round(Number(draft.end));
        if (!(start >= 0 && end > start && text.slice(start, end) === quote) && quote) {
          const at = text.indexOf(quote);
          if (at >= 0) {
            start = at;
            end = at + quote.length;
          }
        }
        try {
          const row = await NW.db.createRevision(
            Object.assign({}, draft, {
              chapterId: current.id,
              novelId: current.novelId || '',
              start: Number.isFinite(start) ? Math.max(0, start) : 0,
              end: Number.isFinite(end) ? Math.max(0, end) : 0,
            }),
          );
          if (!aliveRef.current) return null;
          await refreshRevisions();
          return row || null;
        } catch (err) {
          pushToast(errText(err, '保存修改建议失败'), 'error');
          return null;
        }
      },
      [pushToast, refreshRevisions],
    );

    const removeRevision = useCallback(
      async (row) => {
        if (!row || row.id == null || typeof NW.db.deleteRevision !== 'function') return;
        try {
          await NW.db.deleteRevision(row.id);
          if (!aliveRef.current) return;
          await refreshRevisions();
        } catch (err) {
          pushToast(errText(err, '删除修改建议失败'), 'error');
        }
      },
      [pushToast, refreshRevisions],
    );

    // ---- 标注：新增 / 删除 / 改批注 -----------------------------------------
    const addMark = useCallback(
      async (draft) => {
        if (!draft || typeof NW.db.createMark !== 'function') return null;
        const current = chapterRef.current;
        const novelId = current && String(current.id) === String(draft.chapterId)
          ? current.novelId
          : (chapters.filter((row) => row && String(row.id) === String(draft.chapterId))[0] || {}).novelId;
        try {
          const created = await NW.db.createMark(Object.assign({}, draft, { novelId: novelId || '' }));
          if (!aliveRef.current) return null;
          await refreshMarks();
          return created || null;
        } catch (err) {
          pushToast(errText(err, '保存标注失败'), 'error');
          return null;
        }
      },
      [chapters, refreshMarks, pushToast],
    );

    const removeMark = useCallback(
      async (id) => {
        if (!id || typeof NW.db.deleteMark !== 'function') return;
        try {
          await NW.db.deleteMark(id);
          if (!aliveRef.current) return;
          await refreshMarks();
        } catch (err) {
          pushToast(errText(err, '删除标注失败'), 'error');
        }
      },
      [refreshMarks, pushToast],
    );

    const noteMark = useCallback(
      async (id, note) => {
        if (!id || typeof NW.db.updateMark !== 'function') return;
        try {
          await NW.db.updateMark(id, { note: note });
          if (!aliveRef.current) return;
          await refreshMarks();
        } catch (err) {
          pushToast(errText(err, '保存批注失败'), 'error');
        }
      },
      [refreshMarks, pushToast],
    );

    /**
     * R47: the buffer was saved and its text moved — drag this chapter's
     * annotations along with it, so an underline stays under the words it was
     * drawn on instead of under whatever happens to sit at those offsets now.
     */
    const shiftMarks = useCallback(
      async (diff, chapterId) => {
        // R81: prefer the id the editor handed over. The editor's unmount flush
        // runs after React has already swapped `chapterRef` to the next chapter,
        // so reading it here could shift the wrong chapter's marks.
        const current = chapterId != null ? { id: chapterId } : chapterRef.current;
        if (!current || current.id == null) return;
        if (!diff) return;
        // R73: accepted suggestions are pinned to their words by the same diff —
        // editing the paragraph around them must not leave 「已接收」 pointing at
        // the neighbours of the sentence it was about.
        // R77: but only when this chapter actually has accepted rows. Reading the
        // index on every save for a chapter that never had one is a wasted IDB
        // round trip on the typing path.
        const hasRevisionsHere = revisionsRef.current.some(
          (row) => row && String(row.chapterId) === String(current.id),
        );
        if (hasRevisionsHere && typeof NW.db.shiftRevisionsForEdit === 'function') {
          try {
            const moved = await NW.db.shiftRevisionsForEdit(current.id, diff);
            if (aliveRef.current && moved) await refreshRevisions();
          } catch (err) {
            /* an accepted suggestion must never break a save */
          }
        }
        if (typeof NW.db.shiftMarksForEdit !== 'function') return;
        try {
          const changed = await NW.db.shiftMarksForEdit(current.id, diff);
          if (!aliveRef.current || !changed) return;
          await refreshMarks();
        } catch (err) {
          /* annotations are a convenience; never let one break a save */
        }
      },
      [refreshMarks, refreshRevisions],
    );

    /**
     * R43 ④: after a pull, bring the *open* chapter up to date as well.
     *
     * `NW.db.applyBooks` only rewrites IndexedDB. The chapter being edited lives
     * in React state, and the editor adopts new text only when its `chapter`
     * prop changes (`60-editor.js` keys that effect on `chapter.content`), so an
     * edit the phone made to the chapter you are staring at was written to the
     * database and nowhere else — it only appeared after switching chapters or
     * reloading. That read as "手机上的改动同步不到电脑".
     *
     * Two guards, both deliberate:
     * - unsaved keystrokes win; adopting over them would throw them away;
     * - the text is compared before `setChapter`, because re-rendering the
     *   editor on every tick would move the caret while the author types.
     */
    const adoptRemoteChapter = useCallback(async (books) => {
      const current = chapterRef.current;
      if (!current || current.id == null) return false;
      if (!Array.isArray(books) || !books.length) return false;
      const mine = books.find(
        (book) => book && book.id != null && String(book.id) === String(current.novelId),
      );
      // A deleted book is the shelf's business, not the editor's.
      if (!mine || mine.deleted === true) return false;
      if (saveStateRef.current === 'dirty' || saveStateRef.current === 'saving') return false;
      let record = null;
      try {
        record = await NW.db.getChapter(current.id);
      } catch (err) {
        return false;
      }
      if (!record || record.id == null) return false;
      const next = typeof record.content === 'string' ? record.content : '';
      const api = editorRef.current;
      let shown = '';
      try {
        shown = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : '';
      } catch (err) {
        shown = '';
      }
      if (!shown) shown = String(current.content || '');
      if (next === shown) return false;
      if (!aliveRef.current) return false;
      setChapter(record);
      return true;
    }, []);

    /**
     * R34 ④: pull the host mirror and apply whatever actually moved.
     *
     * Declared after refreshNovels/refreshChapters on purpose — a useCallback that
     * captures them earlier would close over the temporal dead zone and the whole
     * panel would fail to mount (the build gate catches it, but only after a full
     * bundle pass).
     *
     * The diff matters more than the pull: the mirror holds the *merged* result,
     * so applying it wholesale every few seconds would rewrite every chapter row
     * on every tick and make the editor think the text changed underneath the
     * caret. Only books whose remote `updatedAt` is strictly newer than the local
     * row — or that the remote calls deleted while we still have them — reach
     * `applyBooks`.
     *
     * No toast on success: this runs on a timer while the user is writing, and a
     * book that arrived from the phone announces itself through the shelf.
     */
    const pullSync = useCallback(async () => {
      try {
        const data = await NW.io.sync.pull();
        // R38: the pull doubles as the heartbeat for "did a phone sync recently".
        // `lastSyncAt` is written host-side by markPeerSync(); before this the
        // settings page could only report the browser's own counters, which a
        // phone sync never touches — hence 「还没有同步过」 on a phone that had
        // just synced. Fold it in before the early return so a quiet tick still
        // refreshes the timestamp.
        if (aliveRef.current) {
          const hostSync = Number(data && data.lastSyncAt) || 0;
          const peerCount = Number(data && data.peers) || 0;
          setLanSync((prev) => {
            if (hostSync <= Number(prev.lastSyncAt || 0) && peerCount === Number(prev.peers || 0)) return prev;
            return Object.assign({}, prev, {
              lastSyncAt: Math.max(Number(prev.lastSyncAt || 0), hostSync),
              peers: peerCount || prev.peers,
            });
          });
        }
        const remote = data && data.library && Array.isArray(data.library.books) ? data.library.books : [];
        if (!remote.length) return 0;
        const local = new Map();
        for (const row of novelsRef.current) if (row && row.id != null) local.set(String(row.id), row);
        const wanted = [];
        for (const book of remote) {
          if (!book || book.id == null) continue;
          const mine = local.get(String(book.id));
          const theirs = Number(book.updatedAt) || 0;
          if (!mine) {
            // Unknown book: only take it if it is alive. A tombstone for a book we
            // never had is noise from an earlier install.
            if (book.deleted !== true) wanted.push(book);
            continue;
          }
          if (book.deleted === true) {
            wanted.push(book);
            continue;
          }
          const ours = Number(mine.updatedAt) || 0;
          if (theirs > ours) wanted.push(book);
        }
        if (!wanted.length) return 0;
        const touched = await NW.db.applyBooks(wanted);
        if (!touched) return 0;
        await refreshNovels();
        await refreshChapters();
        // R47: a pull can also remove chapters, and their annotations go with
        // them. Without this the underlines of a chapter the phone deleted would
        // keep being drawn until the panel was reloaded.
        await refreshMarks();
        // R43 ④: applyBooks only rewrites IndexedDB. The open chapter lives in
        // React state, and the editor adopts new text only when its `chapter`
        // prop changes — so a phone edit to the chapter you are *looking at*
        // landed in the database and nowhere else until you switched chapters.
        // Re-read the buffer below, but never over unsaved keystrokes.
        await adoptRemoteChapter(wanted);
        if (!aliveRef.current) return touched;
        setLanSync((prev) => Object.assign({}, prev, { pulledAt: Date.now(), pulled: touched }));
        return touched;
      } catch (err) {
        return 0;
      }
    }, [refreshNovels, refreshChapters, adoptRemoteChapter, refreshMarks]);

    /**
     * Poll for the phone's side.
     *
     * There is no server push into the browser: the LAN listener writes to the
     * host mirror, and the only way the page learns about it is by asking. Six
     * seconds is a compromise — faster makes a 30-book library do needless work
     * every tick, slower makes an edit on the phone feel like it did not arrive.
     * `pullSync` short-circuits before touching IndexedDB when nothing changed.
     */
    useEffect(() => {
      if (!ready || locked) return undefined;
      const timer = window.setInterval(() => {
        // R81: a hidden tab decrypts and merges the whole mirror every 6s for
        // nothing. Skip the tick; the next visible one catches up.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        pullSync();
      }, 6000);
      return () => window.clearInterval(timer);
    }, [ready, locked, pullSync]);

    const createNovel = useCallback(async () => {
      try {
        const title = await NW.ui.prompt({
          title: NW.t('新建小说'),
          label: '小说标题',
          value: '',
          placeholder: '未命名小说',
        });
        if (title == null) return;
        const novel = await NW.db.createNovel({ title: String(title).trim() || '未命名小说' });
        await refreshNovels();
        const created = await NW.db.createChapter(novel.id, { title: NW.t('新章节') });
        await refreshChapters();
        if (!aliveRef.current) return;
        setActiveNovelId(novel.id);
        setActiveChapterId(created.id);
        setChapter(created);
        // Creating from the home screen has to land in the editor: the book and
        // its first chapter exist, so staying on the overview would look like
        // the click did nothing.
        setView('write');
        pushToast('小说已创建', 'ok');
      } catch (err) {
        pushToast(errText(err, '新建小说失败'), 'error');
      }
    }, [refreshNovels, refreshChapters, pushToast]);

    const createChapter = useCallback(
      async (parentId) => {
        const novelId = activeNovelId != null ? activeNovelId : chapter && chapter.novelId;
        if (novelId == null) {
          pushToast('请先新建或选择一部小说', 'error');
          return;
        }
        try {
          flushEditor();
          // R22: number the default title. Every chapter used to be called
          // 新章节, so a book of ten chapters showed ten identical rows.
          const siblings = (Array.isArray(chapters) ? chapters : []).filter(
            (row) => row && String(row.novelId) === String(novelId) && row.parentId == null,
          );
          const title = NW.t('新章节') + (siblings.length > 0 ? ' ' + (siblings.length + 1) : '');
          const created = await NW.db.createChapter(novelId, { parentId: parentId == null ? null : parentId, title: title });
          await refreshChapters();
          if (!aliveRef.current) return;
          setActiveChapterId(created.id);
          setChapter(created);
          setSaveState('saved');
          // R22: a new chapter is meant to be written in, so open the editor.
          setView('write');
        } catch (err) {
          pushToast(errText(err, '新建章节失败'), 'error');
        }
      },
      [activeNovelId, chapter, chapters, flushEditor, refreshChapters, pushToast],
    );

    const renameNode = useCallback(
      async (kind, id, current) => {
        try {
          const next = await NW.ui.prompt({ title: NW.t('重命名'), label: kind === 'novel' ? '小说标题' : '章节标题', value: current || '' });
          if (next == null) return;
          const value = String(next).trim();
          if (!value) return;
          if (kind === 'novel') await NW.db.updateNovel(id, { title: value });
          else {
            await NW.db.updateChapter(id, { title: value });
            if (activeChapterId != null && String(id) === String(activeChapterId)) {
              setChapter((prev) => (prev ? Object.assign({}, prev, { title: value }) : prev));
            }
          }
          await refreshChapters();
          await refreshNovels();
        } catch (err) {
          pushToast(errText(err, '重命名失败'), 'error');
        }
      },
      [activeChapterId, refreshChapters, refreshNovels, pushToast],
    );

    // R41 ①: renaming straight from the manuscript heading. Deliberately NOT a
    // call to renameNode(): that one asks through a dialog and then reloads every
    // chapter (including all their content) just to repaint a label. Here the
    // list and the open chapter are patched first — the caret is already in the
    // heading, so the change must land instantly — and only then written to the
    // database, whose row is the authority for the final string.
    const renameChapterTitle = useCallback(
      async (id, nextTitle) => {
        if (id == null) return null;
        const value = String(nextTitle == null ? '' : nextTitle).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!value) return null;
        patchChapterInList(id, { title: value });
        if (activeChapterId != null && String(id) === String(activeChapterId)) {
          setChapter((prev) => (prev ? Object.assign({}, prev, { title: value }) : prev));
        }
        try {
          const record = await NW.db.updateChapter(id, { title: value });
          const applied = record && record.title != null ? String(record.title) : value;
          if (applied !== value) {
            patchChapterInList(id, { title: applied });
            if (activeChapterId != null && String(id) === String(activeChapterId)) {
              setChapter((prev) => (prev ? Object.assign({}, prev, { title: applied }) : prev));
            }
          }
          return applied;
        } catch (err) {
          // The optimistic edit stays on screen (the row is still the old one in
          // the database, so a reload shows the truth) but the writer is told.
          pushToast(errText(err, '重命名失败'), 'error');
          return null;
        }
      },
      [activeChapterId, patchChapterInList, pushToast],
    );

    const deleteNode = useCallback(
      async (kind, id) => {
        const ok = await NW.ui.confirm(
          kind === 'novel' ? '删除这部小说及其全部章节？删除后可在回收站恢复。' : '删除这个章节？删除后可在回收站恢复。',
          { danger: true, title: NW.t('确认删除') },
        );
        if (!ok) return;
        let trashId = null;
        try {
          flushEditor();
          // R22: remember where the doomed chapter sat before the delete, so the
          // cursor can fall through to its neighbour instead of the library head.
          const before = Array.isArray(chapters) ? chapters : [];
          const gone = before.find((row) => row && String(row.id) === String(id)) || null;
          const novelOf = (gone && gone.novelId) || activeNovelId;
          // The index has to be counted inside the doomed chapter's own book.
          // `chapters` holds every book, so an index taken from it pointed at a
          // neighbour in another novel — or past the end — and deleting a chapter
          // jumped to an unrelated one.
          const siblingBefore = before.filter(
            (row) => row && novelOf != null && String(row.novelId) === String(novelOf),
          );
          const goneIndex = siblingBefore.findIndex((row) => row && String(row.id) === String(id));
          if (kind === 'novel') trashId = await NW.db.deleteNovel(id);
          else trashId = await NW.db.deleteChapter(id);
          const novelRows = await refreshNovels();
          const chapterRows = await refreshChapters();
          if (!aliveRef.current) return;
          if (kind === 'novel' && String(activeNovelId) === String(id)) {
            const first = (novelRows || [])[0];
            setActiveNovelId(first ? first.id : null);
            setActiveChapterId(null);
            setChapter(null);
          } else if (kind === 'chapter' && String(activeChapterId) === String(id)) {
            // Fall through to the chapter that took its place (the next sibling,
            // else the previous one) — never jump to another book.
            const siblings = (chapterRows || []).filter(
              (row) => row && novelOf != null && String(row.novelId) === String(novelOf),
            );
            let next = null;
            if (goneIndex >= 0 && siblings.length > 0) {
              next = siblings[Math.min(goneIndex, siblings.length - 1)] || null;
            }
            if (!next) next = siblings[0] || (chapterRows || [])[0] || null;
            setActiveChapterId(next ? next.id : null);
            setChapter(next || null);
            if (next) setActiveNovelId(next.novelId);
          }
          if (trashId) {
            pushToast('已移入回收站', 'ok', {
              label: '撤销',
              onClick: () => {
                NW.db
                  .restoreTrash(trashId)
                  .then(() => Promise.all([refreshNovels(), refreshChapters()]))
                  .then(([novelRows, chapterRows]) => {
                    if (!aliveRef.current) return;
                    if (kind === 'chapter') {
                      const back = (chapterRows || []).find((row) => String(row.id) === String(id));
                      if (back) {
                        setActiveChapterId(back.id);
                        setActiveNovelId(back.novelId);
                        setChapter(back);
                        setView('write');
                      }
                    } else if (novelRows && novelRows.length) {
                      const back = novelRows.find((row) => String(row.id) === String(id));
                      if (back) setActiveNovelId(back.id);
                    }
                    pushToast('已恢复', 'ok');
                  })
                  .catch((err) => pushToast(errText(err, '恢复失败'), 'error'));
              },
            });
          } else {
            pushToast('已移入回收站', 'ok');
          }
        } catch (err) {
          pushToast(errText(err, '删除失败'), 'error');
        }
      },
      [activeNovelId, activeChapterId, chapters, flushEditor, refreshNovels, refreshChapters, pushToast],
    );

    const moveNode = useCallback(
      async (id, parentId, index) => {
        try {
          await NW.db.moveChapter(id, parentId, index);
          await refreshChapters();
        } catch (err) {
          pushToast(errText(err, '移动失败'), 'error');
        }
      },
      [refreshChapters, pushToast],
    );

    // --------------------------------------------------------- settings -----
    const applySettings = useCallback(
      async (patch) => {
        try {
          setSettings((prev) => Object.assign({}, prev, patch || {}));
          const saved = await NW.db.saveSettings(patch || {});
          if (aliveRef.current && saved) setSettings(Object.assign({}, NW.db.DEFAULT_SETTINGS || {}, saved));
          // R80: keep the host copy current; a host reinstall replaces the WebView
          // profile, not DSH_HOME, so this is the copy that brings settings back.
          pushSettingsSoon();
        } catch (err) {
          pushToast(errText(err, '保存设置失败'), 'error');
        }
      },
      [pushToast],
    );

    // ----------------------------------------------------------- locking ----
    const doLock = useCallback(async () => {
      // Order matters: flush (writes plaintext), snapshot (needs plaintext),
      // encrypt every stored body while the key is still in hand, THEN drop the
      // key. Calling lock() first would leave plaintext on disk for good.
      flushEditor();
      await snapshotVersion();
      try {
        if (NW.crypto && NW.crypto.hasPassword && (await NW.crypto.hasPassword())) {
          let sealed = 0;
          try {
            if (settings.encryption && NW.crypto.isUnlocked && NW.crypto.isUnlocked()) {
              sealed = await NW.db.encryptAll();
            }
          } catch (err) {
            /* encryption is best-effort; locking must still happen */
          }
          NW.crypto.lock();
          setLocked(true);
          setImmersive(false);
          setChapters((list) => list.map((row) => (row ? Object.assign({}, row, { content: '' }) : row)));
          setChapter(null);
          setDialog(null);
          if (sealed > 0) pushToast('已加密 ' + sealed + ' 段正文并上锁', 'ok');
        } else {
          setDialog({ kind: 'lockSetup' });
        }
      } catch (err) {
        pushToast(errText(err, '锁定失败'), 'error');
      }
    }, [flushEditor, snapshotVersion, pushToast, settings.encryption]);

    /**
     * Password just configured (from the lock dialog or Settings). Turn on
     * at-rest encryption, seal everything currently stored, then immediately
     * enter the locked state — otherwise "set a password" leaves the studio
     * wide open, which is exactly what users do not expect.
     */
    const lockAfterSetup = useCallback(
      async (password) => {
        // Persist the buffered body *before* the key goes away; afterwards the
        // editor's unmount flush is plaintext and db refuses it on purpose.
        flushEditor();
        await snapshotVersion();
        if (password != null) await NW.crypto.setPassword(password);
        await applySettings({ lockEnabled: true, encryption: true });
        let sealed = 0;
        try {
          sealed = await NW.db.encryptAll();
        } catch (err) {
          /* best-effort */
        }
        setChapters((list) => list.map((row) => (row ? Object.assign({}, row, { content: '' }) : row)));
        setChapter(null);
        NW.crypto.lock();
        setLocked(true);
        setDialog(null);
        return sealed;
      },
      [applySettings, flushEditor, snapshotVersion],
    );

    /** Turns at-rest encryption on/off for existing rows (requires unlocked). */
    const toggleEncryption = useCallback(
      async (on) => {
        if (!NW.crypto || !NW.crypto.hasPassword || !(await NW.crypto.hasPassword())) {
          pushToast('请先设置密码', 'warn');
          return false;
        }
        if (!NW.crypto.isUnlocked || !NW.crypto.isUnlocked()) {
          pushToast('已锁定，请先解锁', 'warn');
          return false;
        }
        await applySettings({ encryption: !!on });
        const touched = on ? await NW.db.encryptAll() : await NW.db.decryptAll();
        await refreshChapters();
        pushToast(on ? '已加密 ' + touched + ' 段正文' : '已还原 ' + touched + ' 段正文为明文', 'ok');
        return true;
      },
      [applySettings, refreshChapters, pushToast],
    );

    const unlock = useCallback(
      async (password) => {
        try {
          const ok = await NW.crypto.unlock(password);
          if (!ok) return false;
          const data = await loadAll();
          if (data) {
            const initial = pickInitial(data);
            setActiveNovelId(initial.novelId == null ? null : initial.novelId);
            setActiveChapterId(initial.chapter ? initial.chapter.id : null);
            setChapter(initial.chapter || null);
          }
          setLocked(false);
          setSaveState('saved');
          return true;
        } catch (err) {
          pushToast(errText(err, '解锁失败'), 'error');
          return false;
        }
      },
      [loadAll, pickInitial, pushToast],
    );

    const touchActivity = useCallback(() => {
      const now = Date.now();
      if (now - lastTouchRef.current < 4000) return;
      lastTouchRef.current = now;
      if (NW.crypto && NW.crypto.touch) NW.crypto.touch();
    }, []);

    useEffect(() => {
      if (!ready || locked) return undefined;
      const timer = setInterval(() => {
        try {
          const minutes = Number(settings.autoLockMinutes) || 0;
          if (!settings.lockEnabled || minutes <= 0) return;
          if (NW.crypto && NW.crypto.autoLocked && NW.crypto.autoLocked(minutes)) {
            doLock();
          }
        } catch (err) {
          /* ignore */
        }
      }, 15000);
      return () => clearInterval(timer);
    }, [ready, locked, settings.lockEnabled, settings.autoLockMinutes, doLock]);

    // Global shortcut: Ctrl/Cmd+Shift+L locks the studio.
    useEffect(() => {
      const onKey = (ev) => {
        if (!(ev.ctrlKey || ev.metaKey) || !ev.shiftKey) return;
        if (String(ev.key || '').toLowerCase() !== 'l') return;
        ev.preventDefault();
        ev.stopPropagation();
        if (locked) return;
        doLock();
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [locked, doLock]);

    // Global shortcut: Ctrl/Cmd+\ shows or hides the chapter shelf. It is the
    // keyboard twin of the restore handle, so a collapsed shelf can never trap
    // the panel in a state without a way back.
    useEffect(() => {
      const onKey = (ev) => {
        if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) return;
        if (ev.key !== '\\' && ev.code !== 'Backslash') return;
        ev.preventDefault();
        ev.stopPropagation();
        if (locked) return;
        setShelfOpen((open) => !open);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [locked]);

    // Warn before closing the page with unsaved text.
    useEffect(() => {
      const onBeforeUnload = (ev) => {
        if (saveState !== 'saved' && saveState !== 'error') {
          ev.preventDefault();
          ev.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [saveState]);

    // ---------------------------------------------------------- immersive ----
    /**
     * Ask the browser for real fullscreen. Must be called straight from a user
     * gesture (the toolbar click), otherwise Chromium rejects the request.
     * Every failure path is swallowed: fullscreen is a bonus, the immersive
     * layout works without it.
     */
    const enterFullscreen = useCallback(() => {
      try {
        const el = rootRef.current || document.documentElement;
        const fn = el && (el.requestFullscreen || el.webkitRequestFullscreen);
        if (typeof fn === 'function') {
          const ret = fn.call(el);
          if (ret && typeof ret.catch === 'function') ret.catch(() => {});
        }
      } catch (err) {
        /* fullscreen denied — immersive layout alone is enough */
      }
    }, []);

    const exitFullscreen = useCallback(() => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          const fn = document.exitFullscreen || document.webkitExitFullscreen;
          if (typeof fn === 'function') {
            const ret = fn.call(document);
            if (ret && typeof ret.catch === 'function') ret.catch(() => {});
          }
        }
      } catch (err) {
        /* ignore */
      }
    }, []);

    /**
     * Immersive mode = fullscreen + typewriter, per the product requirement.
     * The writing surface keeps the user's own typewriter preference if it is
     * already on; turning immersive on always switches typewriter on, and
     * leaving immersive does not switch it back off (the user may want it).
     */
    const enterImmersive = useCallback(() => {
      if (chapterRef.current == null) return;
      setImmersive(true);
      // Immersive is a writing surface: coming from the home screen has to land
      // in the editor, otherwise the fullscreen canvas would be blank.
      setView('write');
      enterFullscreen();
      if (!settings.typewriter) applySettings({ typewriter: true });
      // Immersive has no visible chrome by design, so the way out is announced
      // once through the existing toast channel instead of a permanent bar.
      // R43 ②: name the new chord too — Esc was the only way out before.
      pushToast('已进入沉浸模式 · Esc 或 Ctrl+Shift+F 退出', 'info');
    }, [applySettings, enterFullscreen, pushToast, settings.typewriter]);

    const exitImmersive = useCallback(() => {
      setImmersive(false);
      exitFullscreen();
    }, [exitFullscreen]);

    const toggleImmersive = useCallback(() => {
      if (immersiveRef.current) exitImmersive();
      else enterImmersive();
    }, [enterImmersive, exitImmersive]);

    // Escape leaves immersive mode (and the browser's own fullscreen Esc works
    // too — listen to fullscreenchange so the two stay in sync).
    useEffect(() => {
      if (!immersive) return undefined;
      // R44: the reading view is stacked above the writing surface and owns
      // Escape while it is open — Esc should close the pages, not the room.
      if (readOpen) return undefined;
      const onKey = (ev) => {
        if (ev.key !== 'Escape' || ev.defaultPrevented) return;
        // A dialog on top owns Escape; only leave immersive when nothing is
        // stacked above the writing surface.
        if (dialog || modalReq) return;
        // R41 ①: this listener runs in the capture phase, i.e. BEFORE React's
        // own onKeyDown reaches the chapter heading, so preventedDefault cannot
        // be the test there. Escape inside the heading means "cancel the
        // rename", never "leave the room".
        const t = ev.target;
        if (t && typeof t.closest === 'function' && t.closest('.nw-chaptertitle')) return;
        exitImmersive();
      };
      const onFsChange = () => {
        try {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            // The user pressed the browser's Escape: drop immersive layout too.
            if (immersiveRef.current) setImmersive(false);
          }
        } catch (err) {
          /* ignore */
        }
      };
      window.addEventListener('keydown', onKey, true);
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      return () => {
        window.removeEventListener('keydown', onKey, true);
        document.removeEventListener('fullscreenchange', onFsChange);
        document.removeEventListener('webkitfullscreenchange', onFsChange);
      };
    }, [immersive, dialog, modalReq, exitImmersive, readOpen]);

    // R44: the pages only make sense for a book. If the active book goes away
    // (deleted, restored snapshot), drop the overlay instead of leaving it up
    // over an empty workspace.
    useEffect(() => {
      if (!activeNovelId && readOpen) setReadOpen(false);
    }, [activeNovelId, readOpen]);

    // R43 ②: a keyboard way into and out of immersive mode.
    //
    // Two spellings on purpose. F11 is what every fullscreen thing uses, but a
    // browser owns that key and never lets a page cancel it, so it only works
    // when the host swallows the press first; Ctrl/Cmd+Shift+F sits next to the
    // existing Ctrl+Shift+L (lock) and Ctrl+\ (shelf) and is the one that is
    // guaranteed to arrive. Leaving is never blocked on a chapter being open —
    // otherwise a closed chapter would strand the user in a chrome-less room.
    useEffect(() => {
      const onKey = (ev) => {
        const chord = (ev.ctrlKey || ev.metaKey) && ev.shiftKey && !ev.altKey
          && String(ev.key || '').toLowerCase() === 'f';
        const plain = ev.key === 'F11' && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey;
        if (!chord && !plain) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (locked) return;
        if (!immersiveRef.current && chapterRef.current == null) return;
        toggleImmersive();
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [locked, toggleImmersive]);

    // ------------------------------------------------- host sidebar auto-hide --
    /**
     * Entering the studio should give the writing surface the whole window, so
     * the host's own left sidebar is collapsed once per session.
     *
     * The layout service exposes `toggleSidebar()` but *no* getter — sidebar
     * width lives in an unexported root store. The only readable signal is the
     * frame's `data-sidebar-collapsed` attribute (rendered by the layout
     * package's AppFrame), so we read the DOM to avoid toggling a sidebar that
     * is already closed and re-opening it by accident.
     *
     * Guarded by sessionStorage so it happens once per session instead of on
     * every panel switch — re-collapsing on each entry would be hostile to
     * anyone who deliberately opened it again.
     */
    const collapseHostSidebar = useCallback(() => {
      let seen = false;
      try {
        seen = sessionStorage.getItem(LS_SIDEBAR_AUTO) === '1';
      } catch (err) {
        /* private mode: fall through and try once per mount */
      }
      if (seen) return;
      // R40: resolve the service *before* burning the once-per-session flag.
      // The old order marked the session as handled even when `layout` was not
      // there yet, so a boot that lost the race never auto-collapsed at all.
      const layout = NW.layoutService();
      if (!layout || typeof layout.toggleSidebar !== 'function') return;
      try {
        sessionStorage.setItem(LS_SIDEBAR_AUTO, '1');
      } catch (err) {
        /* ignore */
      }
      let collapsed = false;
      try {
        collapsed = !!document.querySelector(SIDEBAR_COLLAPSED_SELECTOR);
      } catch (err) {
        collapsed = false;
      }
      if (collapsed) return;
      try {
        layout.toggleSidebar();
      } catch (err) {
        /* ignore — layout unavailable */
      }
    }, []);

    /**
     * Manual toggle for the host sidebar. Collapsing removes the rail entirely
     * on Windows (the shell renders a zero-width track when the window carries
     * a native titlebar), which would strand the user without a visible way
     * back to the other panels — so this button lives in our own toolbar and
     * is always reachable while the studio is open.
     */
    const toggleHostSidebar = useCallback(() => {
      const layout = NW.layoutService();
      if (!layout || typeof layout.toggleSidebar !== 'function') {
        // R40: say so. A button that swallows the failure is indistinguishable
        // from a broken button, which is exactly how this one got reported.
        pushToast('宿主侧边栏服务暂不可用，请稍后再试', 'error');
        return;
      }
      try {
        layout.toggleSidebar();
        // The frame attribute is rendered synchronously by React, so a rAF is
        // enough to read the post-toggle state for the toast text.
        const done = () => {
          let nowCollapsed = false;
          try {
            nowCollapsed = !!document.querySelector(SIDEBAR_COLLAPSED_SELECTOR);
          } catch (err) {
            nowCollapsed = false;
          }
          pushToast(nowCollapsed ? '已收起宿主左侧栏' : '已展开宿主左侧栏', 'info');
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
        else setTimeout(done, 16);
      } catch (err) {
        pushToast('宿主侧边栏切换失败', 'error');
      }
    }, [pushToast]);

    useEffect(() => {
      if (!ready || locked) return;
      collapseHostSidebar();
    }, [ready, locked, collapseHostSidebar]);


    // ------------------------------------------------------------- export ---
    /**
     * Builds the payload the host's `export.build` expects. `options.target`
     * narrows the export to one chapter (`{kind:'chapter'}`, used by the
     * per-chapter "⋯" menu); otherwise the whole active novel is exported.
     *
     * The closing signature (`options.appendText`) is passed through as
     * `options.appendText` on the host side, which knows how to append it to
     * docx/epub/txt respectively — see docs/CONTRACT-R3.md §10.
     */
    const exportNow = useCallback(
      async (options) => {
        const opts = options || {};
        const novel = novels.filter((n) => n && String(n.id) === String(activeNovelId))[0] || {};
        if (activeNovelId == null) {
          pushToast('请先选择一部小说', 'error');
          return;
        }
        const format = String(opts.format || settings.exportFormat || 'docx');
        const target = opts.target && opts.target.kind === 'chapter' ? opts.target : null;
        setBusy('正在导出…');
        try {
          const rows = await NW.db.listChapters(activeNovelId);
          let chapters = (rows || [])
            .filter((row) => row && row.id)
            .map((row, index) => ({
              title: row.title || NW.t('章节') + ' ' + (index + 1),
              content: String(row.content || ''),
            }));
          if (target && target.id != null) {
            const hit = (rows || []).filter((row) => row && String(row.id) === String(target.id))[0];
            if (!hit) {
              pushToast('找不到要导出的章节', 'error');
              return;
            }
            chapters = [{ title: hit.title || NW.t('章节'), content: String(hit.content || '') }];
          }
          const payload = {
            title: target ? target.title || novel.title || '未命名小说' : novel.title || '未命名小说',
            author: opts.includeMeta === false ? '' : novel.author || '',
            chapters: chapters,
          };
          const hostOptions = Object.assign({}, opts.options || {});
          if (opts.appendOn !== false && opts.appendText) {
            hostOptions.appendText = String(opts.appendText).slice(0, 8000);
          }
          await NW.io.exportProject(payload, format, hostOptions);
          pushToast('导出完成', 'ok');
          setDialog(null);
        } catch (err) {
          pushToast(errText(err, '导出失败'), 'error');
        } finally {
          if (aliveRef.current) setBusy('');
        }
      },
      [novels, activeNovelId, settings.exportFormat, pushToast],
    );

    /**
     * R35 ②: 一键导出所有书籍. The in-memory chapter list only covers the active
     * novel, so every other book is read chapter by chapter here; the host then
     * builds all the documents and hands back one zip.
     */
    const exportAllNow = useCallback(
      async (options) => {
        const opts = options || {};
        const books = novels.filter(Boolean);
        if (books.length === 0) {
          pushToast('还没有作品可导出', 'error');
          return;
        }
        const format = String(opts.format || settings.exportFormat || 'docx');
        setBusy('正在导出全部作品…');
        try {
          const payloads = [];
          for (const novel of books) {
            const rows = await NW.db.listChapters(novel.id);
            payloads.push({
              title: novel.title || '未命名小说',
              author: opts.includeMeta === false ? '' : novel.author || '',
              chapters: (rows || [])
                .filter((row) => row && row.id)
                .map((row, index) => ({
                  title: row.title || NW.t('章节') + ' ' + (index + 1),
                  content: String(row.content || ''),
                })),
            });
          }
          const hostOptions = Object.assign({}, opts.options || {});
          if (opts.appendOn !== false && opts.appendText) {
            hostOptions.appendText = String(opts.appendText).slice(0, 8000);
          }
          const result = await NW.io.exportAll(payloads, format, hostOptions);
          const failed = result && Array.isArray(result.failed) ? result.failed : [];
          if (failed.length) {
            pushToast('已导出 ' + result.count + ' 部，' + failed.length + ' 部失败', 'error');
          } else {
            pushToast('已导出 ' + result.count + ' 部作品', 'ok');
          }
        } catch (err) {
          pushToast(errText(err, '导出失败'), 'error');
        } finally {
          if (aliveRef.current) setBusy('');
        }
      },
      [novels, settings.exportFormat, pushToast],
    );

    // -------------------------------------------------------------- import --
    const importNow = useCallback(async () => {
      try {
        const files = await NW.io.pickFiles('.txt,.md,.markdown,.docx,.epub');
        if (!files || files.length === 0) return;
        setBusy('正在导入…');
        let lastNovel = null;
        for (let i = 0; i < files.length; i += 1) {
          const parsed = await NW.io.importFile(files[i]);
          const novel = await NW.db.createNovel({ title: parsed.title || '导入的书', author: parsed.author || '' });
          const list = Array.isArray(parsed.chapters) && parsed.chapters.length
            ? parsed.chapters
            : [{ title: '正文', content: '' }];
          // R81: one transaction for the whole book. Per-chapter creation read the
          // whole chapters table every time, so a long novel made the import screen
          // freeze (O(n²)).
          if (typeof NW.db.createChapters === 'function') {
            await NW.db.createChapters(novel.id, list.map((row, j) => ({
              title: (row && row.title) || '第' + (j + 1) + '章',
              content: String((row && row.content) || ''),
            })));
          } else {
            for (let j = 0; j < list.length; j += 1) {
              const row = list[j] || {};
              const created = await NW.db.createChapter(novel.id, { title: row.title || '第' + (j + 1) + '章' });
              await NW.db.saveChapterContent(created.id, String(row.content || ''));
            }
          }
          lastNovel = novel;
          pushToast('已导入《' + (novel.title || '') + '》', 'ok');
        }
        const novelRows = await refreshNovels();
        const chapterRows = await refreshChapters();
        if (lastNovel && aliveRef.current) {
          const first = (chapterRows || []).filter((row) => row && String(row.novelId) === String(lastNovel.id))[0];
          setActiveNovelId(lastNovel.id);
          setActiveChapterId(first ? first.id : null);
          setChapter(first || null);
          if (!novelRows || novelRows.length === 0) setNovels([]);
        }
      } catch (err) {
        pushToast(errText(err, '导入失败'), 'error');
      } finally {
        if (aliveRef.current) setBusy('');
      }
    }, [refreshNovels, refreshChapters, pushToast]);

    // ----------------------------------------------------------- callbacks --
    const getEditorText = useCallback(() => {
      const api = editorRef.current;
      if (api && typeof api.getContent === 'function') {
        try {
          const value = api.getContent();
          if (value != null) return String(value);
        } catch (err) {
          /* fall through to the stored copy */
        }
      }
      return String((chapterRef.current && chapterRef.current.content) || '');
    }, []);

    const registerEditor = useCallback((api) => {
      editorRef.current = api || null;
    }, []);

    const onSelectionChange = useCallback((sel) => {
      setSelection(sel || null);
    }, []);

    // Chapters of the active novel (memoised: shelf receives a stable array).
    const activeNovel = useMemo(
      () => novels.filter((n) => n && String(n.id) === String(activeNovelId))[0] || null,
      [novels, activeNovelId],
    );

    // R44: the reading view takes the whole book, and its body is memoised on
    // this array — a fresh `filter()` on every App render would defeat that and
    // re-split every paragraph of the manuscript on every keystroke.
    const readChapters = useMemo(
      () => chapters.filter((row) => row && String(row.novelId) === String(activeNovelId)),
      [chapters, activeNovelId],
    );

    // R47: annotations of the open book. Books are the unit here because the
    // reading view shows a whole book and the editor only the open chapter —
    // one array serves both, and it stays stable across App renders so the
    // reading view's paragraph memo does not thrash.
    const readMarks = useMemo(
      () => marks.filter((row) => {
        if (!row) return false;
        if (!activeNovelId) return false;
        if (row.novelId) return String(row.novelId) === String(activeNovelId);
        // Rows written before the novel id was recorded fall back to "is this
        // chapter one of ours", which is exact and needs no migration.
        const owner = chapters.filter((c) => c && String(c.id) === String(row.chapterId))[0];
        return !!owner && String(owner.novelId) === String(activeNovelId);
      }),
      [marks, chapters, activeNovelId],
    );

    // R73: the accepted suggestions of the open chapter. Keyed on the chapter,
    // because offsets only mean something inside the text they were taken from;
    // both the dock's column and the selection window read this one slice.
    const chapterRevisions = useMemo(
      () => revisions.filter((row) => row && String(row.chapterId) === String(chapter && chapter.id)),
      [revisions, chapter],
    );

    const wordCounts = useMemo(() => {
      let book = 0;
      let novelWords = 0;
      for (let i = 0; i < chapters.length; i += 1) {
        const row = chapters[i];
        if (!row) continue;
        const words = Number(row.wordCount) || 0;
        book += words;
        if (activeNovelId != null && String(row.novelId) === String(activeNovelId)) novelWords += words;
      }
      return { book: book, novel: novelWords };
    }, [chapters, activeNovelId]);

    const chapterWords = chapter ? Number(chapter.wordCount) || 0 : 0;
    // R77 (B2): 主题最终落到哪一套。手动时就是 settings.theme，自动时按系统亮暗取。
    const autoTheme = settings.themeAuto === true;
    const effectiveTheme = autoTheme
      ? String(settings[systemDark ? 'themeDark' : 'themeLight'] || (systemDark ? 'night' : 'claude'))
      : String(settings.theme || 'claude');
    // Hand the editor/read view a settings object whose `theme` is the resolved
    // one. Identity is stable while nothing changes, so panels do not re-render
    // on every tick.
    const themeSettings = useMemo(
      () => (settings.theme === effectiveTheme ? settings : Object.assign({}, settings, { theme: effectiveTheme })),
      [settings, effectiveTheme],
    );
    // R77: 今日进度。一条记录都没有时显示「今日 0 字」，不编数字。
    const todayWords = Number(dailyStats[dayKeyOf(Date.now())]) || 0;
    const streakDays = (() => {
      const DAY = 86400000;
      const keyOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      let probe = new Date();
      probe = new Date(probe.getFullYear(), probe.getMonth(), probe.getDate());
      if (!(Number(dailyStats[keyOf(probe)]) > 0)) probe = new Date(probe.getTime() - DAY);
      let days = 0;
      for (let i = 0; i < 400; i += 1) {
        if (!(Number(dailyStats[keyOf(probe)]) > 0)) break;
        days += 1;
        probe = new Date(probe.getTime() - DAY);
      }
      return days;
    })();

    const openDialog = useCallback(
      (kind, extra) => {
        setDialog(Object.assign({ kind: kind }, extra || {}));
      },
      [],
    );

    /** Opens the export dialog for a whole book (`'novel'`) or one chapter. */
    const exportTarget = useCallback(
      (kind, id) => {
        let title = '';
        if (kind === 'chapter') {
          const row = chapters.filter((c) => c && String(c.id) === String(id))[0];
          title = row ? row.title || '' : '';
        } else {
          const row = novels.filter((n) => n && String(n.id) === String(id))[0];
          title = row ? row.title || '' : '';
        }
        openDialog('export', { target: { kind: kind, id: id, title: title } });
      },
      [chapters, novels, openDialog],
    );

    /** Collapses/expands the studio's own chapter tree (persisted per browser). */
    const toggleShelf = useCallback(() => {
      setShelfOpen((open) => !open);
    }, []);

    // Immersive has no chrome at all (see below), so the only affordance is a
    // transient toast when it opens — the exit itself is Esc.
    const onRootPointerMove = useCallback(
      (ev) => {
        if (typeof touchActivity === 'function') touchActivity(ev);
      },
      [touchActivity],
    );

    // ------------------------------------------------------------- render ---
    if (!ready) {
      return h('div', { className: 'nw-root' }, h('div', { className: 'nw-center' }, NW.ui.spinner('正在打开书房…')));
    }

    if (bootError) {
      return h(
        'div',
        { className: 'nw-root' },
        h(
          'div',
          { className: 'nw-center' },
          h('p', { style: { marginBottom: '10px' } }, bootError),
          NW.ui.btn({ kind: 'primary', onClick: () => window.location.reload(), children: '重新加载' }),
        ),
      );
    }

    if (locked) {
      return h(
        'div',
        { className: 'nw-root', ref: rootRef },
        h(NW.dialogs.Lock, {
          hasPassword: true,
          onUnlock: unlock,
          onClose: null,
        }),
        h(Toasts, { toasts: toasts, onDismiss: dismissToast }),
      );
    }

    const statusText =
      saveState === 'saving' ? NW.t('保存中…') : saveState === 'error' ? '保存失败' : saveState === 'dirty' ? NW.t('未保存') : NW.t('已保存');
    const saveDot = saveState === 'saving' ? 'busy' : saveState === 'error' ? 'err' : saveState === 'dirty' ? 'busy' : 'ok';
    // R9: the status bar reports the local save folder, not a cloud account.
    // 「自动保存」 is the honest word here — every edit rewrites the encrypted
    // file in place, so there is no pending sync state to report.
    const syncText = !library.dir
      ? '未选保存文件夹'
      : library.mirror !== true
        ? '自动保存未开启'
        : '自动保存' + (library.encrypt === true ? '（加密）' : '') + (library.lastMirrorAt ? ' · ' + NW.fmtDate(library.lastMirrorAt) : '');
    const counterText = selection && (selection.selected || selection.selectionLength)
      ? '选中 ' + (selection.selected || selection.selectionLength) + ' 字'
      : selection && selection.line
        ? '第 ' + selection.line + ' 行 · 第 ' + (selection.col || 1) + ' 列'
        : '';

    const DialogHost = NW.dialogs[cap(dialog && dialog.kind)] || null;

    // R5 removed the top toolbar entirely. Every action it carried now lives in
    // the shelf header or the dock's 「更多」 group, so the writing column starts
    // at the very top of the panel and the only chrome left is the shelf and the
    // status bar. Immersive still removes those two as well.
    const showShelf = !immersive && shelfOpen;

    // Floating action dock: bottom-right, collapsed to one round button so it
    // never covers the writing column (the editor reserves right padding).
    //
    // R47: it stays in immersive mode too. Immersive used to drop every piece of
    // chrome including this one, which left the writer with no way back to the
    // tools short of pressing Esc — the one button that should always be there
    // was the one that vanished. It is dimmed down to a hint instead.
    const dock = h(Dock, {
          immersive: immersive,
          chapter: chapter,
          dockRef: dockRef,
          // R60: the FAB shape is back, so the dock needs the open flag again.
          open: dockOpen,
          onToggle: () => setDockOpen((v) => !v),
          // R58: a blocked row used to be a silently disabled button; now it
          // stays clickable and explains itself through the same toast channel
          // the rest of the shell uses.
          onBlocked: (name) => {
            pushToast('先打开一章，再' + name, 'warn');
          },
          onProofread: () => {
            setDockOpen(false);
            openDialog('proofread');
          },
          onTypeset: () => {
            setDockOpen(false);
            openDialog('typeset');
          },
          onAdvice: () => {
            // The column sits beside the paper, so it must be closable again by
            // the same row — the toggle is the only affordance that survives
            // after the panel takes a third of the width.
            setDockOpen(false);
            // R73: the selection window and this column are two views of the same
            // right-hand lane; opening one closes the other rather than fighting
            // for the width.
            setSelAdvice(null);
            setAdviceOpen((v) => !v);
          },
          onSubmit: () => {
            // R28 ②: AI 投稿 is a one-click path. Standing in a book means the
            // manuscript is already decided, so the wizard opens straight on the
            // preview and picks the model's top journal for the writer; from the
            // home screen there is no manuscript yet, so it opens on step 1.
            setDockOpen(false);
            openDialog(
              'submit',
              view === 'write' && activeNovelId
                ? { step: 3, novelId: activeNovelId }
                : { step: 1 },
            );
          },
          // R44: 读一遍 — the same manuscript, at arm's length.
          onRead: () => {
            setDockOpen(false);
            setReadOpen(true);
          },
        });

    return h(
      'div',
      {
        className: 'nw-root' + (immersive ? ' nw-immersive' : ''),
        ref: rootRef,
        'data-immersive': immersive ? '1' : undefined,
        // The shell follows the reading theme (see 98-shell-theme.js) so the
        // sidebar and toolbar never frame a page in a contradicting palette.
        'data-theme': themeSettings.theme || 'claude',
        onPointerMove: onRootPointerMove,
        onKeyDown: touchActivity,
        onWheel: touchActivity,
      },
      h(
        'div',
        { className: 'nw-body' },
        showShelf
          ? h(
              'div',
              { className: 'nw-side', style: { width: shelfWidth + 'px', flexBasis: shelfWidth + 'px' } },
              h(NW.Shelf, {
                novels: novels,
                chapters: chapters,
                activeNovelId: activeNovelId,
                activeChapterId: activeChapterId,
                settings: settings,
                collapsed: false,
                view: view,
                onSelectNovel: selectNovel,
                onSelectChapter: selectChapter,
                onCreateNovel: createNovel,
                onCreateChapter: createChapter,
                onRename: renameNode,
                onDelete: deleteNode,
                onMove: moveNode,
                // R77: 章节信息（状态 / 简介 / 目标字数）。
                onChapterInfo: (id, title) => openDialog('chapterInfo', { chapterId: id, title: title }),
                // R77: 设定集（人物 / 地点 / 道具 / 设定），按书打开。
                onLore: (id) => openDialog('lore', { novelId: id }),
                onSearch: () => {},
                onImport: importNow,
                onExport: exportTarget,
                onCollapse: toggleShelf,
                onOpenTrash: () => openDialog('trash'),
                onOpenSettings: () => openDialog('settings'),
                // Former toolbar actions — the shelf header is the only strip
                // left above the writing column, so they live here now.
                onHome: () => setView('home'),
                onImmersive: toggleImmersive,
                onToggleHostSidebar: toggleHostSidebar,
                onLock: doLock,
              }),
            )
          : null,
        showShelf
          ? h(NW.Splitter, { width: shelfWidth, onWidth: setShelfWidth, min: 220, max: 640, resetWidth: DEFAULT_WIDTH })
          : null,
        h(
          'div',
          { className: 'nw-main' },
          // R6 fix: the only 收起 button lives in the shelf header, so hiding the
          // shelf used to remove every in-panel route back (dock needs two clicks
          // and reads as a writing tool, not a layout control). This handle stays
          // pinned to the left edge for as long as the shelf is hidden.
          // R16 ③ briefly let the editor's own 目录 button replace this handle on
          // the writing screen; R33 removed that button (首页 restores the shelf),
          // so the edge handle is back everywhere except immersive.
          !showShelf && !immersive
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'nw-shelfrestore',
                  'aria-label': NW.t('显示目录'),
                  title: NW.t('显示目录') + '（Ctrl/Cmd + \\）',
                  onClick: () => setShelfOpen(true),
                },
                h(
                  'span',
                  { className: 'nw-shelfrestore-ico', 'aria-hidden': 'true' },
                  NW.icon('chevright', { size: 14 }),
                ),
                h('span', { className: 'nw-shelfrestore-txt' }, NW.t('目录')),
              )
            : null,
          // Home is the default screen; the editor only mounts once a chapter is
          // actually open. Immersive always means "writing", so it skips home.
          !immersive && view === 'home'
            ? h(NW.Welcome, {
                novels: novels,
                chapters: chapters,
                activeNovelId: activeNovelId,
                hasChapter: !!chapter,
                journalCount: journalCount,
                submissions: submissions,
                inbox: inbox,
                onRefreshInbox: refreshInbox,
                // R12 ④: the rows are clickable now; the reader is a dialog so
                // the writing surface keeps its scroll position.
                onOpenMail: (row) =>
                  setDialog({ kind: 'mail', uid: Number(row && row.uid) || 0, message: row || null }),
                onDeleteMail: deleteMail,
                onOpenNovel: (id) => {
                  selectNovel(id);
                },
                // R41 ③: 正在创作 names the exact chapter now, so a click must
                // land on it. selectChapter() bails out when the requested id is
                // already the open one (it only guards against re-loading), and
                // from the home screen that guard would swallow the click — the
                // chapter is still "open" behind the welcome page. Handle that
                // case by simply going back to the manuscript.
                onResumeChapter: (novelId, chapterId) => {
                  const open = chapterRef.current;
                  if (open && chapterId != null && String(open.id) === String(chapterId)) {
                    setView('write');
                    return;
                  }
                  if (chapterId != null) selectChapter(chapterId);
                  else selectNovel(novelId);
                },
                onResume: () => {
                  if (chapter) setView('write');
                  else if (novels.length > 0) selectNovel(novels[0].id);
                },
                onNewNovel: createNovel,
                onImport: importNow,
                onOpenSubmit: () => openDialog('submit'),
                onOpenSubmitManager: () => openDialog('submitManager'),
                onOpenJournals: () => openDialog('journals'),
                onOpenSettings: () => openDialog('settings'),
              })
            : chapter
              ? h(
                  'div',
                  {
                    className: 'nw-bench',
                    // R25: the bench owns the page measure so its CSS can decide
                    // how much of the leftover width the advice column may take.
                    // --nw-width is set on .nw-surface (inside the paper), so it
                    // cannot be read from here.
                    'data-advice': adviceOpen && !immersive ? '1' : '0',
                    // R73: the selection window pins the paper the same way the
                    // advice column does — 并排 means two columns, not one on top
                    // of the other.
                    'data-selwin': selAdvice && !immersive ? '1' : '0',
                    // R43 ③: the bench's idea of the page measure has to match
                    // what the editor actually lays out. Immersive mode raises
                    // --nw-width to at least 880px (60-editor.js:640), so feeding
                    // the raw setting here made .nw-notes compute its width from
                    // a margin that no longer existed — the card grew into the
                    // text column instead of sitting beside it. Same formula the
                    // editor uses, one source of truth.
                    'data-immersive': immersive ? '1' : '0',
                    style: {
                      '--nw-page': Math.max(
                        clampNum(Number(settings.pageWidth) || 760, 360, 1400),
                        immersive ? 880 : 0
                      ) + 'px',
                    },
                  },
                  h(
                    'div',
                    {
                      className: 'nw-bench-paper',
                      // R24: reserve the left lane only while the card is actually
                      // open — an empty strip of margin would silently narrow the
                      // manuscript for no reason.
                      'data-notes-lane': notesOpen && !immersive ? '1' : '0',
                    },
                    h(NW.Editor, {
                      key: String(chapter.id),
                      chapter: chapter,
                      // R77: the editor follows the resolved theme, not the raw
                      // setting — that is what makes 跟随系统 actually switch.
                      settings: themeSettings,
                      immersive: immersive,
                      // R13: the notes card floats over the paper without a
                      // reserved lane, so the manuscript keeps its full measure
                      // whether the card is open or closed.
                      notesLane: false,
                      // R12 ①: the paper owns its own 首页 button; the shelf
                      // header is gone in immersive mode.
                      // R33: going home also reopens the shelf — that is where
                      // you pick the next book, and a hidden shelf turned this
                      // into a button that looked like it did nothing.
                      // R40: immersive mode short-circuits the home branch
                      // (`!immersive && view === 'home'`), so pressing 首页 while
                      // the canvas was open only flipped a flag nobody could see
                      // — the button looked dead. Leave immersive first, then
                      // navigate; `exitImmersive` also restores fullscreen.
                      onHome: () => {
                        if (immersiveRef.current) exitImmersive();
                        setView('home');
                        setShelfOpen(true);
                      },
                      // R33: the 目录 toggle is gone (首页 now restores the
                      // shelf). Lock stays so the writing surface keeps its own
                      // controls even when DSH chrome is hidden.
                      onLock: doLock,
                      // R22: Alt+N / Alt+A from inside the textarea.
                      onNewChapter: () => createChapter(null),
                      onToggleAdvice: () => setAdviceOpen((v) => !v),
                      onSave: (content) => saveChapter(content, chapter.id),
                      // R41 ①: the manuscript heading is editable in place; the
                      // studio owns the row and answers with the stored title.
                      // The editor calls this as `(chapterId, nextTitle)` — keep the
                      // arity in sync, otherwise the id itself lands in the title.
                      onRenameTitle: (id, next) =>
                        renameChapterTitle(id != null ? id : chapter.id, next),
                      onDirty: (dirty) => {
                        if (dirty) dirtyDuringSaveRef.current = true;
                        setSaveState((prev) => {
                          if (prev === 'saving') return prev;
                          return dirty ? 'dirty' : 'saved';
                        });
                      },
                      onSelectionChange: onSelectionChange,
                      // R73: 选中文字后浮出的小方钮点下去就是这里。开这扇窗口意味着
                      // 要并排看原文和改写，所以整章的修改建议栏先让位。
                      onAdviceSelection: (sel) => {
                        if (!sel || !String(sel.text || '').trim()) return;
                        setSelAdvice(sel);
                        setAdviceOpen(false);
                      },
                      // R47: annotations on the open chapter, and the hook that
                      // keeps them pinned while the writer edits the text.
                      marks: readMarks,
                      onMarksShift: shiftMarks,
                      // R51: the card that opens when a line is clicked can
                      // delete the mark — deleting is a reading-time decision.
                      onMarkRemove: removeMark,
                      // R52: and a selection in the paper can create one, so the
                      // writing surface is not the one place where you can see
                      // your marks but never make one.
                      onMarkCreate: addMark,
                      registerApi: registerEditor,
                    }),
                    // R13: 灵感便签 floats over the paper itself, not over the
                    // whole writing column — with the advice panel open the
                    // card would otherwise drift on top of the suggestions.
                    h(Notes, {
                      open: notesOpen,
                      text: noteText,
                      chapterId: chapter.id,
                      onToggle: () => setNotesOpen((v) => !v),
                      onSave: saveNotes,
                    }),
                  ),
                  adviceOpen && !immersive
                    ? h(NW.Advice, {
                        key: 'advice-' + String(chapter.id),
                        chapter: chapter,
                        editorApi: editorRef,
                        settings: settings,
                        width: adviceWidth,
                        onResize: setAdviceWidth,
                        onClose: () => setAdviceOpen(false),
                        // R34: only used to announce a silent model failover.
                        onToast: pushToast,
                        // R73: 接受/拒绝 and the folded 已接收 directory. Both
                        // surfaces share one store, so a decision made here is
                        // already there when the selection window opens.
                        accepted: chapterRevisions,
                        onAccept: acceptRevision,
                        onRemoveAccepted: removeRevision,
                      })
                    : null,
                  // R73: the selection window. Keyed on the range so asking again
                  // about different words starts a fresh read instead of showing
                  // the previous selection's cards.
                  selAdvice && !immersive
                    ? h(NW.SelectionAdvice, {
                        key: 'seladvice-' + String(chapter.id) + '-' + String(selAdvice.start) + '-' + String(selAdvice.end),
                        chapter: chapter,
                        editorApi: editorRef,
                        selection: selAdvice,
                        accepted: chapterRevisions,
                        onAccept: acceptRevision,
                        onRemoveAccepted: removeRevision,
                        // R76: 复制 / 替换 / 撤销替换 report through the same toast bus.
                        onToast: pushToast,
                        onClose: () => setSelAdvice(null),
                      })
                    : null,
                )
              : h(
                  'div',
                  { className: 'nw-center' },
                  NW.ui.empty(
                    novels.length === 0 ? NW.t('还没有小说') : '左侧选择一个章节开始写作',
                    novels.length === 0
                      ? NW.ui.btn({ kind: 'primary', onClick: createNovel, children: NW.t('新建小说') })
                      : NW.ui.btn({ onClick: () => setView('home'), children: '返回首页' }),
                  ),
                ),
          // R54e: 浮动坞只在写作页出现。它原本无条件挂在 `.nw-main` 里，而首页
          // 也渲染在 `.nw-main` 中，于是「AI 校对 / 一键排版 / 读一遍 / 投稿」
          // 这几个按钮浮在了首页右下角 —— 那些动作在首页没有一个可用（`chapter`
          // 为空时全部 disabled），只剩下一枚关不掉的圆按钮压在快捷入口上。
          // 首页有自己的卡片和操作行，不需要这块坞。
          //
          // R83: 修改建议栏展开时整块坞不渲染。栏占着右侧车道，圆钮正好压在
          // 建议卡片的下沿；收起状态下它也没有一个动作可点（修改建议正是打开
          // 这一栏的入口），先让位，关掉栏再回来。沉浸模式下栏不出现，坞照旧。
          view === 'write' || immersive
            ? adviceOpen && !immersive
              ? null
              : dock
            : null,
        ),
      ),
      // R44: 读一遍 — the book laid out as pages, covering the whole panel.
      //
      // It is an overlay, not a route: the editor stays mounted underneath, so
      // the caret, the scroll position and any unsaved buffer are exactly where
      // the writer left them when the pages close. Nothing of the workspace
      // shows through — a book has no file tree and no save indicator.
      readOpen && activeNovelId
        ? h(NW.ReadView, {
            novel: activeNovel,
            chapters: readChapters,
            currentId: chapter ? chapter.id : null,
            // The editor buffer can be ahead of the last autosave, so the open
            // chapter is read from the live text, not from the stored row.
            currentText: getEditorText(),
            settings: themeSettings,
            // R47: reading is also when a writer notices — so this is where an
            // annotation can be drawn. The marks are the shell's, not the view's:
            // the same array feeds the editor underneath, so a line underlined
            // while reading is still underlined when writing resumes.
            marks: readMarks,
            onMark: addMark,
            onUnmark: removeMark,
            onNote: noteMark,
            // Closing puts the writer back in the sentence they were in: the
            // textarea never unmounted, so focusing it restores the very caret
            // they left, with the scroll position the pages covered up.
            onClose: () => {
              setReadOpen(false);
              window.requestAnimationFrame(() => {
                const api = editorRef.current;
                if (api && typeof api.focus === 'function') {
                  try {
                    api.focus();
                  } catch (err) {
                    /* the editor may be gone; nothing to restore */
                  }
                }
              });
            },
          })
        : null,
      // Immersive is a pure canvas: no toolbar, no shelf, no status bar. The only
      // exit is Esc (registered below), so nothing steals vertical space.
      immersive
        ? null
        : h(NW.StatusBar, {
            saveState: saveDot,
            saveText: statusText + (savedAt ? ' · ' + NW.fmtDate(savedAt) : ''),
            middle: h(
              'span',
              { className: 'nw-status-mid', style: { display: 'inline-flex', gap: '14px', alignItems: 'center' } },
              h('span', null, '本章 ' + NW.fmtWords(chapterWords) + ' 字'),
              h('span', null, '本书 ' + NW.fmtWords(wordCounts.novel) + ' 字'),
              h('span', null, '全部 ' + NW.fmtWords(wordCounts.book) + ' 字'),
              // R77: 今日 + 连续。负数也照实说（改稿删字也是当天的账）。
              h(
                'span',
                { className: 'nw-status-today', 'data-sign': todayWords < 0 ? 'down' : 'up' },
                '今日 ' + (todayWords > 0 ? '+' : '') + NW.fmtWords(todayWords) + ' 字'
                  + (streakDays > 1 ? ' · 连续 ' + streakDays + ' 天' : ''),
              ),
            ),
            syncText: syncText,
            wordText: '',
            counterText: counterText,
          }),
      DialogHost
        ? h(DialogHost, {
            dialog: dialog,
            chapter: chapter,
            novel: activeNovel,
            settings: settings,
            novels: novels,
            chapters: chapters,
            capabilities: caps,
            editorApi: editorRef,
            onClose: () => setDialog(null),
            getText: getEditorText,
            onSettings: applySettings,
            onToast: pushToast,
            onExport: exportNow,
            onSelectChapter: selectChapter,
            onRefreshData: async () => {
              await refreshNovels();
              await refreshChapters();
              // R34: the submission log lives on the host and a restore may have
              // merged statuses into it, so the home screen has to re-read it.
              await refreshHomeFeed();
              await refreshNotes();
              const data = await loadAll();
              if (!aliveRef.current) return;
              // A restored snapshot carries the ids of the session that produced
              // it, so the chapter the editor is
              // showing may not exist any more. Resolve a chapter that really is
              // in the new data — otherwise the buffer would keep describing a
              // deleted row and the next autosave would recreate it as a stray
              // chapter with stale text.
              const rows = (data && Array.isArray(data.chapters) ? data.chapters : []).filter(Boolean);
              const activeId = chapterRef.current ? chapterRef.current.id : null;
              let fresh = null;
              if (activeId != null) fresh = rows.filter((row) => String(row.id) === String(activeId))[0] || null;
              if (!fresh) fresh = rows[0] || null;
              if (!fresh) {
                setChapter(null);
                setActiveChapterId(null);
                return;
              }
              if (String(fresh.id) !== String(activeId)) {
                // Different chapter: changing the id remounts NW.Editor, which
                // loads the restored text through its normal chapter effect.
                setActiveNovelId(fresh.novelId == null ? null : fresh.novelId);
                setActiveChapterId(fresh.id);
                setChapter(fresh);
                setSaveState('saved');
                return;
              }
              const loaded = (await NW.db.getChapter(fresh.id)) || fresh;
              if (!aliveRef.current) return;
              setChapter(loaded);
              setSaveState('saved');
              // Same chapter id: NW.Editor is uncontrolled and only resets on an
              // id change, so push the restored text into the live buffer.
              const api = editorRef.current;
              if (api && typeof api.setContent === 'function' && typeof loaded.content === 'string') {
                api.setContent(loaded.content);
              }
            },
            onSetBusy: setBusy,
            onFlush: flushEditor,
            onSnapshotVersion: snapshotVersion,
            onLock: doLock,
            onLockSetup: lockAfterSetup,
            onToggleEncryption: toggleEncryption,
            // R35 ②: the settings page's 「一键导出全部书籍」 row.
            onExportAll: exportAllNow,
            onOpenBackup: () => setDialog({ kind: 'backup' }),
            // Settings hosts the entry points that used to live in the toolbar
            // (backup, version history, submission, export defaults), so it needs
            // a way to open another dialog on top of itself.
            onOpenDialog: (kind, extra) => openDialog(kind, extra),
            // R34 ③: the pairing QR lives in its own dialog so the settings page
            // stays a list of fields rather than a wall of one-off actions.
            onOpenPair: () => openDialog('pair'),
            // What the phone will see. Refreshed whenever the library changes, so
            // a sync that happens while this window is open carries the latest
            // edits instead of a boot-time copy.
            syncLibrary: syncLibrary,
            syncState: lanSync,
            // Defaults the Export dialog seeds itself with (closing signature).
            exportDefaults: {
              appendText: String(settings.exportSignature || ''),
              appendOn: settings.exportSignatureOn === true,
            },
            onSubmitSent: () => {
              setDialog(null);
              pushToast('投稿已发送', 'ok');
              // Keep the home screen's 投稿记录 card honest without a reload.
              refreshHomeFeed();
            },
            // R34 a: 投稿管理 owns the same log as the home screen's 投稿记录
            // card. Marking a row 已撤回 there rewrote submissions.json but the
            // card kept its boot-time copy, so the badge never moved until the
            // next launch. Every writer of the log calls this afterwards.
            onSubmissionChanged: refreshHomeFeed,
            // R14 ②: opening a mail marks it \Seen on the server, so the card
            // has to re-read the mailbox or it keeps showing the old 未读 count.
            // Refreshed in the background — the reader is already open.
            onMailRead: () => {
              refreshInbox();
              refreshHomeFeed();
            },
            // R17 ②: the reader's 「去投稿」 button used to call `p.onReply`,
            // which DialogHost never passed — so the button was inert. Route it
            // into the submit wizard the same way 「重新投稿」 does; the wizard
            // defaults to the open novel and the mail's journal when known.
            onReply: (mail) => {
              setDialog({
                kind: 'submit',
                step: 1,
                journalId: String((mail && mail.journalId) || ''),
              });
            },
            // 投稿管理 → 「重新投稿」 reopens the wizard on step 1 with that
            // journal already selected. R42: carry the book too — the record now
            // knows which novel it belongs to, and the wizard would otherwise
            // fall back to whatever book happens to be first in the shelf, which
            // is how a resubmission ended up logged under the wrong work.
            onResubmit: (row) => {
              setDialog({
                kind: 'submit',
                step: 1,
                journalId: String((row && row.journalId) || ''),
                novelId: String((row && row.novelId) || ''),
              });
            },
            library: library,
            onLibrary: async (patch) => {
              // Persist on the host half first, then mirror the current library
              // when the user asked for it. `library.set` also stores `mirror`,
              // so a failed mirror still leaves the preference saved.
              const next = await NW.io.library.set(patch);
              if (!aliveRef.current) return next;
              const resolved = {
                dir: String((next && next.dir) || ''),
                mirror: next && next.mirror === true,
                encrypt: next && next.encrypt === true,
                lastMirrorAt: Number(next && next.lastMirrorAt) || 0,
                dirExists: true,
              };
              setLibrary(resolved);
              // Mirror with the *new* configuration: `setLibrary` has not landed
              // yet, so the hook closure still holds the previous folder.
              if (resolved.mirror && resolved.dir) {
                const data = await mirrorLibrary({ override: resolved });
                if (data && Number(data.lastMirrorAt)) resolved.lastMirrorAt = Number(data.lastMirrorAt);
              }
              return Object.assign({}, resolved);
            },
            onLibraryMirror: mirrorLibrary,
          })
        : null,
      modalReq ? h(ModalRequest, { req: modalReq, onDone: () => setModalReq(null) }) : null,
      modelPicker
        ? h(ModelPicker, {
            req: modelPicker.req,
            onDone: (picked) => {
              const resolve = modelPicker.resolve;
              setModelPicker(null);
              // Resolve after the state flip so the dialog is gone before the
              // retried request starts painting a spinner somewhere else.
              if (typeof resolve === 'function') resolve(picked || null);
            },
          })
        : null,
      h(Toasts, { toasts: toasts, onDismiss: dismissToast }),
    );
  };

  function cap(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // ---------------------------------------------------------------- dock -----
  // R60: back to a collapsed FAB that opens a menu of five rows. R57 spread the
  // five actions out as permanent single characters because the writer asked for
  // that; after living with it for a few rounds the answer was "还是改回悬浮坞
  // 吧". So the shape returns, but the *structure* keeps R59's finding: the dock
  // div itself owns no hit-testable area. No padding, no gap, no background on
  // the container — every visible surface is painted by a button or its ::before.
  // That is what made "上半部分是箭头 / 点了没反应" possible in the first place:
  // the rail used to be 144px tall with a 5px padding band that belonged to a
  // plain div with cursor:auto. A collapsed FAB has the same failure mode if the
  // menu rows are spaced apart inside a container that paints nothing.
  //
  // The round shape is painted, not owned: `.nw-dock-fab` is a square transparent
  // box and the circle is its ::before. R54d/R54f/R54g/R56 spent four rounds
  // teaching that a rounded control asks the browser to hit-test a shape it will
  // not reliably answer; a square box with a painted circle asks nothing.
  function Dock(props) {
    const p = props || {};
    const open = !!p.open;

    /**
     * One action row. `disabled` is still gone (R58): a disabled button fires
     * nothing at all, and "the screen did not change" is indistinguishable from
     * a bug. The row stays clickable and says why it cannot act.
     */
    const item = (iconName, name, onClick, needsChapter) => {
      const blocked = needsChapter && !p.chapter;
      return h(
        'button',
        {
          type: 'button',
          className: 'nw-dock-btn',
          role: 'menuitem',
          'data-blocked': blocked ? '1' : '0',
          'aria-disabled': blocked ? 'true' : undefined,
          onClick: () => {
            if (blocked) {
              if (typeof p.onBlocked === 'function') p.onBlocked(name);
              return;
            }
            if (typeof onClick === 'function') onClick();
          },
          title: blocked ? name + '（先打开一章）' : name,
          'aria-label': name,
        },
        h('span', { className: 'nw-dock-icon', 'aria-hidden': 'true' }, NW.icon(iconName, { size: 16 })),
        h('span', { className: 'nw-dock-name' }, name),
      );
    };

    return h(
      'div',
      {
        className: 'nw-dock',
        ref: p.dockRef,
        'data-immersive': p.immersive ? '1' : '0',
        'data-open': open ? '1' : '0',
      },
      h(
        'div',
        { className: 'nw-dock-menu', 'data-open': open ? '1' : '0', role: 'menu', 'aria-hidden': open ? 'false' : 'true' },
        // R67b：顺序是按**名字的长短**排的，不是按重要性 —— 阶梯要从长到短，
        // 名字也要从长到短，两个方向一致才不会出现「最上面那级最长、字却最短，
        // 中间空出一大块」。所以「AI 校对」挪下来，紧挨在「读一遍」上面。
        // 修改建议 toggles the advice column beside the paper, so its row stays
        // lit while that column is open.
        item('typeset', NW.t('一键排版'), p.onTypeset, true),
        item('sparkle', NW.t('修改建议'), p.onAdvice, true),
        item('proofread', NW.t('AI 校对'), p.onProofread, true),
        item('book', NW.t('读一遍'), p.onRead, true),
        item('send', NW.t('投稿'), p.onSubmit, true),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'nw-dock-fab',
          'aria-expanded': open ? 'true' : 'false',
          'aria-haspopup': 'menu',
          'aria-label': open ? NW.t('收起写作工具') : NW.t('展开写作工具'),
          title: open ? NW.t('收起写作工具') : NW.t('展开写作工具'),
          onClick: p.onToggle,
        },
        h(
          'span',
          { className: 'nw-dock-fabicon', 'aria-hidden': 'true' },
          NW.icon(open ? 'x' : 'pencil', { size: 20 }),
        ),
      ),
    );
  }

  /**
   * 灵感便签 (R10): a narrow floating column pinned to the right edge of the
   * writing area, so an idea can be captured without leaving the manuscript.
   *
   * Layout contract: it is positioned inside `.nw-main` (which is already
   * `position:relative`) and never overlaps the text column — the editor reserves
   * `--nw-gutter-x` for the dock, and the notes panel is narrower than that
   * gutter, so the two can be open at the same time. Collapsed it is a single
   * small tab, which is what the writer sees most of the time.
   */
  /* 修改建议 / 选中改写 (R73–R76) 已搬到 92-advice.js —— 它只通过
     props 与工作室说话，放在这里只是让 90-app 重新长出三千行。 */

/** Clamp a number into [lo, hi]; non-finite input falls back to `lo`. */
  function clampNum(value, lo, hi) {
    const n = Number(value);
    if (!Number.isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  /** Keep a 0..1 scroll ratio inside its bounds (scrollTo multiplies it). */
  function clampRatio(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  /**
   * 灵感便签 (R11) — a solid-colour editing page and nothing else.
   *
   * The R10 version was a 196px card with a header, a badge, a list and a
   * button row; the user asked for a plain page instead. So the open state is
   * one full-bleed sheet of paper colour holding a single textarea: no title,
   * no counts, no buttons. The whole note body is edited as one document —
   * stored notes are joined on open and written back as a single note on
   * Ctrl/Cmd+Enter or blur, which keeps the model simple and the page empty.
   */
  function Notes(props) {
    const p = props || {};
    const [text, setText] = useState('');
    const [state, setState] = useState('idle');
    const areaRef = useRef(null);
    const savedRef = useRef('');
    const lastChapterRef = useRef(p.chapterId);
    const timerRef = useRef(0);

    // R14 ③: the card is bound to one chapter, so the seed is a single string
    // handed down by the App (`p.text`), not a list of rows to join. The text
    // also arrives one render later (the App loads it from IndexedDB), which is
    // why `p.text` is a dependency — the `savedRef` guard keeps a save that
    // echoes our own keystrokes from resetting the caret.
    useEffect(() => {
      const next = String(p.text == null ? '' : p.text);
      const switched = lastChapterRef.current !== p.chapterId;
      lastChapterRef.current = p.chapterId;
      if (!switched && next === savedRef.current) return;
      savedRef.current = next;
      // While the card has focus, a value echoed back by the save round trip
      // must not overwrite what is being typed (it would jump the caret). A
      // chapter switch is the exception — that content is a different note.
      if (!switched && areaRef.current && document.activeElement === areaRef.current) return;
      setText(next);
      setState('idle');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p.chapterId, p.open, p.text]);

    // Autosave: 600ms after the last keystroke. Blur/Esc still commit at once so
    // closing the card never loses the last sentence.
    const flush = (value) => {
      const body = String(value == null ? '' : value);
      if (body === savedRef.current) return;
      savedRef.current = body;
      setState('saved');
      // Hand the chapter along: the debounce can outlive a chapter switch, and
      // the note must land on the chapter it was typed in.
      if (typeof p.onSave === 'function') p.onSave(body, p.chapterId);
    };

    const schedule = (value) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState('typing');
      timerRef.current = setTimeout(() => {
        timerRef.current = 0;
        flush(value);
      }, 600);
    };

    const commit = (value) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
      flush(value);
    };

    useEffect(
      () => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      },
      [],
    );

    // Auto-grow: the box follows the text instead of scrolling inside a fixed
    // 96px window. Re-measured on every value change and when the card opens
    // (a chapter switch can change the text length without a keystroke).
    useEffect(() => {
      const el = areaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`;
    }, [text, p.open]);

    return h(
      'aside',
      {
        className: 'nw-notes',
        'data-open': p.open ? '1' : '0',
        'aria-label': NW.t('灵感便签'),
        'aria-hidden': p.open ? undefined : 'true',
      },
      h(
        'button',
        {
          type: 'button',
          className: 'nw-notes-tab',
          'aria-expanded': p.open ? 'true' : 'false',
          title: p.open ? NW.t('收起灵感便签') : NW.t('展开灵感便签'),
          'aria-label': p.open ? NW.t('收起灵感便签') : NW.t('展开灵感便签'),
          onClick: p.onToggle,
        },
        h('span', { className: 'nw-notes-tabicon', 'aria-hidden': 'true' }, NW.icon('sparkle', { size: 16 })),
        // The label doubles as the state: closed it invites you in, open it is
        // the collapse handle the card itself does not otherwise have.
        h('span', { className: 'nw-notes-tabtxt' }, p.open ? NW.t('收起') : NW.t('灵感')),
      ),
      p.open
        ? h(
            'div',
            { className: 'nw-notes-card', role: 'dialog', 'aria-label': NW.t('灵感便签') },
            // R16 ④: no header/footer strips. The state word and the close button
            // float over the corner and only surface on hover or keyboard focus,
            // so the card is nothing but paper and the note itself.
            h(
              'div',
              { className: 'nw-notes-tools' },
              h(
                'span',
                { className: 'nw-notes-state' },
                state === 'typing' ? NW.t('未保存') : text ? NW.t('已保存') : NW.t('空白'),
              ),
              NW.ui.btn({
                kind: 'icon',
                title: NW.t('收起灵感便签'),
                ariaLabel: NW.t('收起灵感便签'),
                onClick: () => {
                  commit(text);
                  if (typeof p.onToggle === 'function') p.onToggle();
                },
                children: NW.icon('x', { size: 14 }),
              }),
            ),
            h('textarea', {
              ref: areaRef,
              className: 'nw-notes-input',
              value: text,
              rows: 3,
              spellCheck: false,
              placeholder: NW.t('随手记一句：一个画面、一句对白、一个转折…'),
              'aria-label': NW.t('灵感便签'),
              onChange: (ev) => {
                setText(ev.target.value);
                schedule(ev.target.value);
              },
              onBlur: (ev) => commit(ev.target.value),
              onKeyDown: (ev) => {
                // Escape closes the card (and commits) — Enter is plain newline
                // now that saving is automatic.
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  commit(ev.target.value);
                  if (typeof p.onToggle === 'function') p.onToggle();
                }
              },
            }),
          )
        : null,
    );
  }

  // ------------------------------------------------------------------ misc ---
  function Toasts(props) {
    const list = (props && props.toasts) || [];
    const dismiss = typeof props.onDismiss === 'function' ? props.onDismiss : null;
    if (list.length === 0) return null;
    return h(
      'div',
      { className: 'nw-toast-wrap', role: 'status', 'aria-live': 'polite' },
      list.map((row) =>
        h(
          'div',
          { key: row.id, className: 'nw-toast', 'data-kind': row.kind },
          h('span', { className: 'nw-toast-text' }, row.message),
          row.actionLabel
            ? h(
                'button',
                {
                  className: 'nw-toast-act',
                  type: 'button',
                  onClick: () => {
                    if (dismiss) dismiss(row.id);
                    try {
                      row.onClick();
                    } catch (err) {
                      /* the action owns its own error reporting */
                    }
                  },
                },
                row.actionLabel,
              )
            : null,
        ),
      ),
    );
  }

  function ModalRequest(props) {
    const req = (props && props.req) || {};
    const isPrompt = req.kind === 'prompt';
    const [value, setValue] = useState(isPrompt ? String(req.value || '') : '');
    const inputRef = useRef(null);

    useEffect(() => {
      if (isPrompt && inputRef.current) {
        try {
          inputRef.current.focus();
          inputRef.current.select();
        } catch (err) {
          /* ignore */
        }
      }
    }, [isPrompt]);

    const done = (result) => {
      if (typeof req.resolve === 'function') req.resolve(result);
      if (props.onDone) props.onDone();
    };

    const submit = () => done(isPrompt ? value : true);
    const cancel = () => done(isPrompt ? null : false);

    // Escape answers the request with "no". It has to be registered here: the
    // dialog underneath already owns a window listener, and before the escape
    // stack existed Escape closed that dialog instead, leaving this prompt
    // stranded while its guarded action went on to run.
    NW.useModalEscape(true, cancel);

    return h(
      'div',
      { className: 'nw-modal-mask', role: 'presentation' },
      h(
        'div',
        { className: 'nw-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': req.title || '' },
        h('div', { className: 'nw-modal-head' }, h('h2', null, req.title || NW.t('确定'))),
        h(
          'div',
          { className: 'nw-modal-body' },
          req.text ? h('p', { style: { margin: '0 0 10px', fontSize: '12.5px', lineHeight: 1.7 } }, req.text) : null,
          isPrompt
            ? (req.multiline
                ? NW.ui.textarea({
                    value: value,
                    onChange: setValue,
                    rows: 6,
                    placeholder: req.placeholder || '',
                    ariaLabel: req.label || req.title || '',
                  })
                : NW.ui.input({
                    value: value,
                    onChange: setValue,
                    placeholder: req.placeholder || '',
                    ariaLabel: req.label || req.title || '',
                    autoFocus: true,
                  }))
            : null,
        ),
        h(
          'div',
          { className: 'nw-modal-foot' },
          NW.ui.btn({ onClick: cancel, children: NW.t('取消') }),
          NW.ui.btn({ kind: req.danger ? 'danger' : 'primary', onClick: submit, children: req.okText || NW.t('确定') }),
        ),
      ),
    );
  }

  // --------------------------------------------------------- model picker ----
  /**
   * R34: 「模型连不上时，弹出选择其他模型的窗口」.
   *
   * Shown only after every configured model has failed, so the writer never sees
   * it during normal operation. It lists what was tried (with the host's own
   * message for each) and every other pair the host knows about, so picking one
   * is a single click instead of a trip through Settings.
   */
  function ModelPicker(props) {
    const p = props || {};
    const req = p.req || {};
    const list = req.models || null;
    const picked = req.preferred || {};
    const options = useMemo(() => {
      const seen = new Set();
      const rows = [];
      for (const row of (list && list.models) || []) {
        if (!row) continue;
        const key = String(row.provider) + '\u0000' + String(row.id);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          value: key,
          label: (row.name || row.id) + ' · ' + row.provider,
        });
      }
      const current = (list && list.current) || {};
      const currentKey = current.provider && current.model ? String(current.provider) + '\u0000' + String(current.model) : '';
      if (currentKey && !seen.has(currentKey)) {
        rows.unshift({ value: currentKey, label: String(current.model) + ' · ' + String(current.provider) + '（当前默认）' });
      }
      return rows;
    }, [list]);

    const [value, setValue] = useState(() => {
      const first = options[0];
      return first ? first.value : '';
    });
    // R82: this picker is a second modal mask. Without registering here Escape
    // closed the dialog underneath and left the picker stranded.
    NW.useModalEscape(true, () => {
      if (typeof p.onDone === 'function') p.onDone(null);
    });
    const tried = Array.isArray(req.tried) ? req.tried : [];
    // R34: the caller passes a Chinese label ('AI 校对' / 'AI 投稿' / '修改建议');
    // translate it here so the picker reads as one sentence in either language.
    const label = NW.t(String(req.label || '本次请求'));
    const failedLine =
      picked.provider && picked.model
        ? NW.t('{0}用 {1} · {2} 没有成功，换一个模型再试一次？', label, String(picked.model), String(picked.provider))
        : NW.t('{0}没有可用的模型，换一个模型再试一次？', label);

    const confirm = () => {
      if (!value) return;
      const parts = value.split('\u0000');
      p.onDone({ provider: parts[0], model: parts.slice(1).join('\u0000') });
    };

    return h(
      'div',
      { className: 'nw-modal-mask', role: 'presentation' },
      h(
        'div',
        { className: 'nw-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': NW.t('换个模型重试') },
        h('div', { className: 'nw-modal-head' }, h('h2', null, NW.t('换个模型重试'))),
        h(
          'div',
          { className: 'nw-modal-body' },
          h(
            'p',
            { className: 'nw-hint-block' },
            failedLine,
          ),
          tried.length
            ? h(
                'ul',
                { className: 'nw-picker-tried' },
                tried.slice(0, 6).map((row, index) =>
                  h('li', { key: 't' + index }, h('span', { className: 'nw-picker-triedname' }, row.label), h('span', { className: 'nw-picker-triedmsg' }, row.message)),
                ),
              )
            : null,
          h(
            'div',
            { className: 'nw-field' },
            h('label', null, NW.t('改用这个模型')),
            options.length
              ? NW.ui.select({ value: value, options: options, onChange: setValue, ariaLabel: NW.t('改用这个模型') })
              : h('div', { className: 'nw-lock-error' }, NW.t('没有可用的模型，请先在 Harness 里登录一个模型提供方。')),
          ),
        ),
        h(
          'div',
          { className: 'nw-modal-foot' },
          NW.ui.btn({ onClick: () => p.onDone(null), children: NW.t('取消') }),
          NW.ui.btn({ kind: 'primary', onClick: confirm, disabled: !value, children: NW.t('重试') }),
        ),
      ),
    );
  }

  // ----------------------------------------------------------------- services --
  /**
   * R40: the host's `layout` service, fetched on every use.
   *
   * The service is provided by the shell's own client plugin, and `ctx.get()`
   * only answers once that plugin's fiber is active — the apply order between
   * two plugins is not something a third one can rely on. Reading it a single
   * time during apply therefore cached `null` on any boot where the shell came
   * up second, which turned 「收起宿主侧栏」 into a button that did nothing at all
   * (no error, no toast, no clue). Re-reading here is cheap: it is a map lookup
   * on the host store, and it means a late provider heals itself on first click.
   */
  NW.layoutService = function layoutService() {
    const ctx = NW._ctx;
    if (ctx && typeof ctx.get === 'function') {
      try {
        const live = ctx.get('layout') || null;
        if (live) {
          NW._layout = live;
          return live;
        }
      } catch (err) {
        /* fall through to the cached handle */
      }
    }
    return NW._layout || null;
  };

  // --------------------------------------------------------------- apply -----
  NW.apply = function apply(ctx) {
    if (NW._applied) return;
    NW._applied = true;
    const disposers = [];
    const push = (fn) => {
      if (typeof fn === 'function') disposers.push(fn);
    };

    try {
      push(NW.bindLocale(ctx));
    } catch (err) {
      console.error('[novel-writer] locale registration failed', err);
    }

    // Stylesheet: prefer the package-owned `styles` builtin, fall back to a
    // <style> node in <head> (never document.body).
    try {
      const css = NW.CSS_PARTS.join('\n');
      if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') {
        push(styles.insert(css));
      } else if (typeof document !== 'undefined') {
        const el = document.createElement('style');
        el.setAttribute('data-novel-writer', '1');
        el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
        push(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        });
      }
    } catch (err) {
      console.error('[novel-writer] stylesheet injection failed', err);
    }

    // R40: the host provides `layout` from its own client plugin, and plugin
    // apply order is not ours to decide — reading it once here could cache null
    // forever and leave 「收起宿主侧栏」 a dead button with no error. Keep the handle
    // we get now for the unload hook, but let every *use* re-read the service
    // through `NW.layoutService()`, which retries on the injected context and
    // only then falls back to the stale handle.
    try {
      NW._ctx = ctx;
    } catch (err) {
      NW._ctx = null;
    }
    const layout = NW.layoutService();
    // Service handles the dialogs need (uiWorkspace for the native folder
    // picker). Stored on NW so any part can reach them without threading props
    // through every component.
    try {
      NW._workspace = ctx.get('uiWorkspace') || null;
    } catch (err) {
      NW._workspace = null;
    }

    const registerPanels = () => {
      const offMain = ctx.slots.register({ name: 'main', key: PANEL_ID, locale: 'novel-writer' }, () => h(NW.App));
      const offRow = ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => NW.t('精神空间'), locale: 'novel-writer' },
        (owner) => h(NW.SidebarIcon, { size: (owner && owner.size) || 16 }),
      );
      return () => {
        try {
          if (layout && layout.panelInfo && layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) layout.selectPanel(null);
        } catch (err) {
          /* ignore */
        }
        if (typeof offRow === 'function') offRow();
        if (typeof offMain === 'function') offMain();
      };
    };

    try {
      if (typeof ctx.slots.inject === 'function') {
        push(ctx.slots.inject('sidebar.panellist', registerPanels));
      } else {
        push(registerPanels());
      }
    } catch (err) {
      console.error('[novel-writer] slot registration failed', err);
      try {
        push(registerPanels());
      } catch (err2) {
        console.error('[novel-writer] slot registration fallback failed', err2);
      }
    }

    if (typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => () => {
          for (let i = disposers.length - 1; i >= 0; i -= 1) {
            try {
              disposers[i]();
            } catch (err) {
              /* ignore */
            }
          }
          NW._applied = false;
        }, 'novel-writer:client');
      } catch (err) {
        /* ignore */
      }
    }
  };
})();