;(() => {
  'use strict';

  const PANEL_ID = 'novel-writer';
  const LS_NOVEL = 'nw.activeNovel';
  const LS_CHAPTER = 'nw.activeChapter';
  const LS_WIDTH = 'nw.shelfWidth';
  const LS_TYPE_SCALE = 'nw.typeScale.v3';
  const LS_SIDEBAR_AUTO = 'nw.sidebarAutoCollapsed';
  const LS_SHELF_OPEN = 'nw.shelfOpen';
  const LS_NOTES_OPEN = 'nw.notesOpen';
  const DEFAULT_WIDTH = 272;
  // Host layout: the shell renders `data-sidebar-collapsed` on its frame and
  // exposes no getter for the rail state, so the attribute is the only signal.
  const SIDEBAR_COLLAPSED_SELECTOR = '[data-sidebar-collapsed]';

  // Chrome that belongs to the App shell rather than to the theme layer: the
  // floating action dock (bottom-right, never over the text) and the immersive
  // layout (which has no top bar at all — Esc is the only way out).
  NW.CSS_PARTS.push(`
.nw-main{position:relative;}
/* R6: 收起侧栏 曾是一扇单向门 —— 仓库头部的收起按钮随侧栏一起消失，回来只能靠
   浮动坞（先点圆钮再点「显示目录」）。这个把手常驻在写作列左缘，任何时刻一次点击
   就能把目录要回来。沉浸模式不渲染它（沉浸是纯画布，Esc 退出）。 */
.nw-shelfrestore{
  position:absolute;z-index:39;left:0;top:50%;transform:translateY(-50%);
  display:inline-flex;flex-direction:column;align-items:center;gap:8px;
  padding:10px 6px;border-radius:0 10px 10px 0;
  border:1px solid var(--dsw-alias-border-l1);border-left:none;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;opacity:.5;font-size:12px;line-height:1;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease),
             color var(--nw-dur,.18s) var(--nw-ease,ease),
             padding var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-shelfrestore:hover,.nw-shelfrestore:focus-visible{
  opacity:1;color:var(--dsw-alias-label-primary);padding-left:10px;
}
.nw-shelfrestore-txt{writing-mode:vertical-rl;letter-spacing:.2em;max-height:72px;overflow:hidden;}
.nw-dock{
  position:absolute;z-index:40;
  right:20px;bottom:56px;
  display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  opacity:.35;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-dock:hover,.nw-dock:focus-within,.nw-dock[data-open="1"]{opacity:1;}
.nw-dock-fab{
  width:44px;height:44px;border-radius:999px;
  display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-primary);
  box-shadow:0 2px 6px rgba(0,0,0,.08),0 12px 30px rgba(0,0,0,.10);
  cursor:pointer;font-size:18px;line-height:1;
  transition:transform var(--nw-dur,.18s) var(--nw-ease,ease),box-shadow var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-dock-fab:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.1),0 16px 36px rgba(0,0,0,.14);}
.nw-dock-fab:active{transform:translateY(0) scale(.97);}
.nw-dock-menu{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}
.nw-dock-menu[data-open="1"]{animation:nw-pop .18s var(--nw-ease,ease);}
.nw-dock-btn{
  display:inline-flex;align-items:center;gap:8px;
  height:38px;padding:0 16px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-primary);
  font-size:14px;cursor:pointer;white-space:nowrap;
  box-shadow:0 2px 8px rgba(0,0,0,.08);
  transition:transform var(--nw-dur,.18s) var(--nw-ease,ease),background var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-dock-btn:hover{transform:translateY(-1px);background:var(--dsw-alias-bg-layer-2);}
.nw-dock-btn[disabled]{opacity:.45;cursor:default;transform:none;}
/* The dock carries nine rows in R5 (three writing tools + a 「更多」 group), so
   the icon column is fixed-width to keep every label on the same baseline. */
.nw-dock-icon{display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;flex:0 0 auto;color:var(--dsw-alias-label-secondary);}
.nw-dock-btn:hover:not([disabled]) .nw-dock-icon{color:var(--dsw-alias-label-primary);}
.nw-dock-sep{width:100%;height:1px;background:var(--dsw-alias-border-l1);margin:0;flex:0 0 auto;}
.nw-dock-fabicon{display:inline-flex;align-items:center;justify-content:center;}
@keyframes nw-pop{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
/* 灵感便签 (R11). The user asked for a plain solid-colour editing page and
   nothing else, so the open state is a full-bleed sheet of the theme's paper
   colour holding one textarea — no header, no badge, no card, no button row.
   Closed, only a small tab sits on the right edge. */
.nw-notes{
  position:absolute;z-index:35;top:16px;right:8px;bottom:104px;
  display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  pointer-events:none;
}
.nw-notes[data-open="1"]{top:0;right:0;bottom:0;gap:0;}
.nw-notes > *{pointer-events:auto;}
.nw-notes-tab{
  display:inline-flex;align-items:center;gap:6px;
  height:32px;padding:0 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));
  color:var(--dsw-alias-label-secondary);
  font-size:13px;cursor:pointer;opacity:.55;
  transition:opacity var(--nw-dur,.18s) var(--nw-ease,ease),
             transform var(--nw-dur,.18s) var(--nw-ease,ease);
}
.nw-notes[data-open="1"] .nw-notes-tab{
  position:absolute;top:10px;right:10px;z-index:2;
  background:transparent;border-color:transparent;
}
.nw-notes-tab:hover,.nw-notes-tab:focus-visible{opacity:1;transform:translateY(-1px);}
.nw-notes-tabicon{display:inline-flex;align-items:center;justify-content:center;}
.nw-notes-tabtxt{white-space:nowrap;}
/* The page itself: one solid colour, no border, no shadow, no texture. */
.nw-notes-page{
  position:absolute;inset:0;
  display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base);
  animation:nw-fade-in .16s var(--nw-ease,ease);
}
.nw-notes-input{
  flex:1 1 auto;width:100%;box-sizing:border-box;
  border:none;outline:none;resize:none;background:transparent;
  color:var(--dsw-alias-label-primary);
  padding:56px max(48px, calc((100% - 760px) / 2)) 56px;
  font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",serif;
  font-size:17px;line-height:1.9;
  caret-color:var(--dsw-alias-brand-primary);
}
.nw-notes-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.65;}
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
    const map = { light: 'claude', dark: 'night', parchment: 'ink' };
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
    const [settings, setSettings] = useState(() => NW.db.DEFAULT_SETTINGS || {});
    const [activeNovelId, setActiveNovelId] = useState(null);
    const [activeChapterId, setActiveChapterId] = useState(null);
    const [chapter, setChapter] = useState(null);
    const [saveState, setSaveState] = useState('saved');
    const [savedAt, setSavedAt] = useState(0);
    const [selection, setSelection] = useState(null);
    const [shelfWidth, setShelfWidth] = useState(() => {
      const raw = Number(lsGet(LS_WIDTH));
      return Number.isFinite(raw) && raw >= 220 && raw <= 720 ? raw : DEFAULT_WIDTH;
    });
    const [dialog, setDialog] = useState(null);
    const [modalReq, setModalReq] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [locked, setLocked] = useState(false);
    const [busy, setBusy] = useState('');
    const [caps, setCaps] = useState({ docx: true, epub: true, pdf: true, txt: true });
    const [immersive, setImmersive] = useState(false);
    const [library, setLibrary] = useState({ dir: '', mirror: false, encrypt: false, lastMirrorAt: 0, dirExists: false });
    /** Studio's own sidebar (the chapter tree) can be hidden independently of the host rail. */
    const [shelfOpen, setShelfOpen] = useState(() => lsGet(LS_SHELF_OPEN) !== '0');
    /** Bottom-right action dock: collapsed to a single round button by default. */
    const [dockOpen, setDockOpen] = useState(false);
    /**
     * 灵感便签 (R10): notes for the open book, plus whether the panel is
     * expanded. The panel is a narrow column on the right edge of the writing
     * area — collapsed by default so the manuscript keeps the full width, and
     * it never overlaps the text column when open.
     */
    const [notesOpen, setNotesOpen] = useState(() => lsGet(LS_NOTES_OPEN) === '1');
    const [notes, setNotes] = useState([]);
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
    // Set once a silent (autosave) mirror fails, so the user sees the error
    // once instead of on every keystroke-triggered retry.
    const mirrorFailedRef = useRef(false);
    const lastTouchRef = useRef(0);
    const versionRef = useRef({ chapterId: null, at: 0 });
    const chapterRef = useRef(null);
    chapterRef.current = chapter;
    const immersiveRef = useRef(false);
    immersiveRef.current = immersive;

    // ------------------------------------------------------------- toasts ----
    const pushToast = useCallback((message, kind) => {
      const id = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
      setToasts((list) => list.concat([{ id: id, message: String(message), kind: kind || 'info' }]));
      setTimeout(() => {
        if (!aliveRef.current) return;
        setToasts((list) => list.filter((row) => row.id !== id));
      }, 2800);
    }, []);

    useEffect(() => {
      NW.uiToastBus.push = pushToast;
      return () => {
        if (NW.uiToastBus.push === pushToast) NW.uiToastBus.push = null;
      };
    }, [pushToast]);

    useEffect(() => {
      NW.uiModalHost.request = (req) => setModalReq(req);
      return () => {
        NW.uiModalHost.request = null;
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
      const [novelRows, chapterRows, stored] = await Promise.all([
        NW.db.listNovels(),
        NW.db.listChapters(),
        NW.db.getSettings(),
      ]);
      if (!aliveRef.current) return null;
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
      setSettings(nextSettings);
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
    useEffect(() => {
      lsSet(LS_WIDTH, shelfWidth);
    }, [shelfWidth]);
    useEffect(() => {
      lsSet(LS_SHELF_OPEN, shelfOpen ? '1' : '0');
    }, [shelfOpen]);
    useEffect(() => {
      lsSet(LS_NOTES_OPEN, notesOpen ? '1' : '0');
    }, [notesOpen]);

    /**
     * Home-screen data: the submission log and the journal count. Both are
     * host-side reads that may simply not exist on an older host half, so every
     * failure is swallowed — the welcome screen just shows empty states.
     */
    const refreshHomeFeed = useCallback(async () => {
      try {
        const data = await NW.io.submit.record();
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
     * 灵感便签 (R10): load the notes for the open book, and keep them in sync
     * after every create/delete. Notes belong to a book (not a chapter) so an
     * idea jotted down in chapter 3 is still there in chapter 9.
     */
    const refreshNotes = useCallback(async () => {
      try {
        const rows = await NW.db.listNotes(activeNovelId || '');
        if (!aliveRef.current) return;
        setNotes(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (aliveRef.current) setNotes([]);
      }
    }, [activeNovelId]);

    useEffect(() => {
      if (!ready || locked) return;
      refreshNotes();
    }, [ready, locked, refreshNotes]);

    const createNote = useCallback(
      async (text) => {
        const body = String(text == null ? '' : text).trim();
        if (!body) return;
        try {
          await NW.db.createNote({
            novelId: activeNovelId || '',
            chapterId: (chapterRef.current && chapterRef.current.id) || '',
            text: body,
          });
          await refreshNotes();
        } catch (err) {
          pushToast('保存灵感失败', 'err');
        }
      },
      [activeNovelId, refreshNotes, pushToast],
    );

    const deleteNote = useCallback(
      async (id) => {
        try {
          await NW.db.deleteNote(id);
          await refreshNotes();
        } catch (err) {
          /* a failed delete just leaves the note in place */
        }
      },
      [refreshNotes],
    );

    /**
     * R11: the 灵感便签 is now one plain editing page, so saving means
     * "make the stored notes equal this text". Collapsing many rows into one
     * keeps the page identical every time it opens — a note list would put
     * chrome back on a surface the user asked to keep empty.
     */
    const saveNotes = useCallback(
      async (text) => {
        const body = String(text == null ? '' : text).trim();
        try {
          const rows = await NW.db.listNotes(activeNovelId || '');
          const list0 = Array.isArray(rows) ? rows : [];
          if (!body) {
            for (const row of list0) await NW.db.deleteNote(row.id);
            await refreshNotes();
            return;
          }
          if (list0.length === 0) {
            await NW.db.createNote({
              novelId: activeNovelId || '',
              chapterId: (chapterRef.current && chapterRef.current.id) || '',
              text: body,
            });
          } else {
            // Keep the oldest row (stable id) and fold everything else into it.
            const keep = list0[0];
            await NW.db.updateNote(keep.id, { text: body });
            for (let i = 1; i < list0.length; i += 1) await NW.db.deleteNote(list0[i].id);
          }
          await refreshNotes();
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
    const mirrorLibrary = useCallback(async (options) => {
      const silent = !!(options && options.silent === true);
      // `override` lets the caller pass the settings it just persisted: the
      // state update that follows is asynchronous, so the closure still holds
      // the previous folder on the very first save after picking one.
      const cfg = (options && options.override) || library;
      if (!cfg.dir || cfg.mirror !== true) return null;
      try {
        const snapshot = await NW.db.dump();
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
          encrypt: cfg.encrypt === true || settings.libraryEncrypt === true,
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
      return novelPart + '|' + chapterPart + '|' + String(settings.libraryEncrypt === true);
    }, [novels, chapters, settings.libraryEncrypt, library.dir, library.mirror]);

    useEffect(() => {
      if (!ready || locked || !autosaveSignature) return undefined;
      const timer = window.setTimeout(() => {
        mirrorLibrary({ silent: true });
      }, 1200);
      return () => window.clearTimeout(timer);
    }, [ready, locked, autosaveSignature, mirrorLibrary]);

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

    // --------------------------------------------------------- saving -------
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
        try {
          await NW.db.saveChapterContent(targetId, text);
          if (!aliveRef.current) return;
          const words = NW.format.wordCount(text);
          setSaveState('saved');
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

    const snapshotVersion = useCallback(async () => {
      const current = chapterRef.current;
      if (!current || current.id == null) return;
      let text = '';
      const api = editorRef.current;
      try {
        text = api && typeof api.getContent === 'function' ? String(api.getContent() || '') : String(current.content || '');
      } catch (err) {
        text = '';
      }
      const prev = versionRef.current;
      const sameChapter = prev.chapterId != null && String(prev.chapterId) === String(current.id);
      if (sameChapter && Date.now() - prev.at < 60000) return;
      if (!text.trim()) return;
      try {
        await NW.db.saveVersion(current.id, text);
        versionRef.current = { chapterId: current.id, at: Date.now() };
      } catch (err) {
        /* versions are best effort */
      }
    }, []);

    // -------------------------------------------------- chapter selection ----
    const selectChapter = useCallback(
      async (id) => {
        if (id == null) return;
        if (activeChapterId != null && String(id) === String(activeChapterId)) return;
        flushEditor();
        await snapshotVersion();
        try {
          const record = await NW.db.getChapter(id);
          if (!aliveRef.current) return;
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
          await selectChapter(rows[0].id);
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
          const created = await NW.db.createChapter(novelId, { parentId: parentId == null ? null : parentId, title: NW.t('新章节') });
          await refreshChapters();
          if (!aliveRef.current) return;
          setActiveChapterId(created.id);
          setChapter(created);
          setSaveState('saved');
        } catch (err) {
          pushToast(errText(err, '新建章节失败'), 'error');
        }
      },
      [activeNovelId, chapter, flushEditor, refreshChapters, pushToast],
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

    const deleteNode = useCallback(
      async (kind, id) => {
        const ok = await NW.ui.confirm(
          kind === 'novel' ? '删除这部小说及其全部章节？删除后可在回收站恢复。' : '删除这个章节？删除后可在回收站恢复。',
          { danger: true, title: NW.t('确认删除') },
        );
        if (!ok) return;
        try {
          flushEditor();
          if (kind === 'novel') await NW.db.deleteNovel(id);
          else await NW.db.deleteChapter(id);
          const novelRows = await refreshNovels();
          const chapterRows = await refreshChapters();
          if (!aliveRef.current) return;
          if (kind === 'novel' && String(activeNovelId) === String(id)) {
            const first = (novelRows || [])[0];
            setActiveNovelId(first ? first.id : null);
            setActiveChapterId(null);
            setChapter(null);
          } else if (kind === 'chapter' && String(activeChapterId) === String(id)) {
            const next = (chapterRows || [])[0];
            setActiveChapterId(next ? next.id : null);
            setChapter(next || null);
            if (next) setActiveNovelId(next.novelId);
          }
          pushToast('已移入回收站', 'ok');
        } catch (err) {
          pushToast(errText(err, '删除失败'), 'error');
        }
      },
      [activeNovelId, activeChapterId, flushEditor, refreshNovels, refreshChapters, pushToast],
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
      pushToast('已进入沉浸模式 · 按 Esc 退出', 'info');
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
      const onKey = (ev) => {
        if (ev.key !== 'Escape' || ev.defaultPrevented) return;
        // A dialog on top owns Escape; only leave immersive when nothing is
        // stacked above the writing surface.
        if (dialog || modalReq) return;
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
    }, [immersive, dialog, modalReq, exitImmersive]);

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
      try {
        if (sessionStorage.getItem(LS_SIDEBAR_AUTO) === '1') return;
        sessionStorage.setItem(LS_SIDEBAR_AUTO, '1');
      } catch (err) {
        /* private mode: fall through and try once per mount */
      }
      let collapsed = false;
      try {
        collapsed = !!document.querySelector(SIDEBAR_COLLAPSED_SELECTOR);
      } catch (err) {
        collapsed = false;
      }
      if (collapsed) return;
      const layout = NW._layout;
      if (!layout || typeof layout.toggleSidebar !== 'function') return;
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
      const layout = NW._layout;
      if (!layout || typeof layout.toggleSidebar !== 'function') return;
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
        /* ignore */
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
          for (let j = 0; j < list.length; j += 1) {
            const row = list[j] || {};
            const created = await NW.db.createChapter(novel.id, { title: row.title || '第' + (j + 1) + '章' });
            await NW.db.saveChapterContent(created.id, String(row.content || ''));
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
        h(Toasts, { toasts: toasts }),
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
    const dock = immersive
      ? null
      : h(Dock, {
          open: dockOpen,
          onToggle: () => setDockOpen((v) => !v),
          chapter: chapter,
          onProofread: () => {
            setDockOpen(false);
            openDialog('proofread');
          },
          onTypeset: () => {
            setDockOpen(false);
            openDialog('typeset');
          },
          onSubmit: () => {
            setDockOpen(false);
            openDialog('submit');
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
        'data-theme': settings.theme || 'claude',
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
                onOpenNovel: (id) => {
                  selectNovel(id);
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
              ? h(NW.Editor, {
                  key: String(chapter.id),
                  chapter: chapter,
                  settings: settings,
                  immersive: immersive,
                  // R11: the 灵感便签 is now a full-bleed page that covers the
                  // writing area while open, so the manuscript no longer needs a
                  // reserved right lane — it keeps its full measure either way.
                  notesLane: false,
                  onSave: (content) => saveChapter(content, chapter.id),
                  onSelectionChange: onSelectionChange,
                  registerApi: registerEditor,
                })
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
          dock,
          // 灵感便签: only alongside an actual manuscript — the home screen has
          // its own cards and does not need a floating note page.
          !immersive && chapter
            ? h(Notes, {
                open: notesOpen,
                notes: notes,
                onToggle: () => setNotesOpen((v) => !v),
                onSave: saveNotes,
              })
            : null,
        ),
      ),
      // Immersive is a pure canvas: no toolbar, no shelf, no status bar. The only
      // exit is Esc (registered below), so nothing steals vertical space.
      immersive
        ? null
        : h(NW.StatusBar, {
            saveState: saveDot,
            saveText: statusText + (savedAt ? ' · ' + NW.fmtDate(savedAt) : ''),
            middle: h(
              'span',
              { style: { display: 'inline-flex', gap: '14px', alignItems: 'center' } },
              h('span', null, '本章 ' + NW.fmtWords(chapterWords) + ' 字'),
              h('span', null, '本书 ' + NW.fmtWords(wordCounts.novel) + ' 字'),
              h('span', null, '全部 ' + NW.fmtWords(wordCounts.book) + ' 字'),
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
            onOpenBackup: () => setDialog({ kind: 'backup' }),
            // Settings hosts the entry points that used to live in the toolbar
            // (backup, version history, submission, export defaults), so it needs
            // a way to open another dialog on top of itself.
            onOpenDialog: (kind, extra) => openDialog(kind, extra),
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
            // 投稿管理 → 「重新投稿」 reopens the wizard on step 1 with that
            // journal already selected.
            onResubmit: (row) => {
              setDialog({ kind: 'submit', step: 1, journalId: String((row && row.journalId) || '') });
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
      h(Toasts, { toasts: toasts }),
    );
  };

  function cap(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // ---------------------------------------------------------------- dock -----
  // The toolbar is gone (R5): 四个写作工具 + 更多 live in this dock instead. It is
  // collapsed to a single round button so it never covers the writing column.
  function Dock(props) {
    const p = props || {};
    const open = !!p.open;

    /** One menu row: icon + label, disabled when the action needs a chapter. */
    const item = (iconName, label, onClick, needsChapter) =>
      h(
        'button',
        {
          type: 'button',
          className: 'nw-dock-btn',
          role: 'menuitem',
          disabled: needsChapter ? !p.chapter : false,
          onClick: onClick,
          title: label,
        },
        h('span', { className: 'nw-dock-icon', 'aria-hidden': 'true' }, NW.icon(iconName, { size: 16 })),
        h('span', null, label),
      );

    // R10: the dock carries only the three writing actions. Everything that is
    // really a setting moved there (theme, typewriter, layout, lock), and the
    // home/shelf toggles already have their own permanently visible handles —
    // a nine-row menu read as a second toolbar, which is what the user objected
    // to. Fewer rows also means the collapsed FAB stays the only thing on top
    // of the writing column.
    return h(
      'div',
      { className: 'nw-dock', 'data-open': open ? '1' : '0' },
      open
        ? h(
            'div',
            { className: 'nw-dock-menu', 'data-open': '1', role: 'menu' },
            item('proofread', NW.t('AI 校对'), p.onProofread, true),
            item('typeset', NW.t('一键排版'), p.onTypeset, true),
            item('send', NW.t('投稿'), p.onSubmit, true),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          className: 'nw-dock-fab',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': open ? NW.t('收起写作工具') : NW.t('展开写作工具'),
          title: open ? NW.t('收起写作工具') : NW.t('展开写作工具'),
          onClick: p.onToggle,
        },
        h(
          'span',
          { className: 'nw-dock-fabicon', 'aria-hidden': 'true' },
          NW.icon(open ? 'x' : 'pencil', { size: 18 }),
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
    const list = Array.isArray(p.notes) ? p.notes : [];
    const [text, setText] = useState('');
    const areaRef = useRef(null);
    const savedRef = useRef('');

    // Seed the page whenever it opens, or when the stored notes change while
    // it is closed (e.g. another window wrote a note).
    useEffect(() => {
      if (!p.open) return;
      const joined = list
        .map((row) => String((row && row.text) || '').trim())
        .filter(Boolean)
        .join('\n\n');
      savedRef.current = joined;
      setText(joined);
      const timer = setTimeout(() => {
        if (areaRef.current) areaRef.current.focus();
      }, 30);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p.open]);

    const commit = () => {
      const body = text;
      if (body === savedRef.current) return;
      savedRef.current = body;
      if (typeof p.onSave === 'function') p.onSave(body);
    };

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
        h('span', { className: 'nw-notes-tabicon', 'aria-hidden': 'true' }, NW.icon('sparkle', { size: 15 })),
        p.open ? null : h('span', { className: 'nw-notes-tabtxt' }, NW.t('灵感')),
      ),
      p.open
        ? h(
            'div',
            { className: 'nw-notes-page' },
            h('textarea', {
              ref: areaRef,
              className: 'nw-notes-input',
              value: text,
              spellCheck: false,
              placeholder: NW.t('随手记一句：一个画面、一句对白、一个转折…'),
              'aria-label': NW.t('灵感便签'),
              onChange: (ev) => setText(ev.target.value),
              onBlur: commit,
              onKeyDown: (ev) => {
                // Ctrl/Cmd + Enter commits without leaving the keyboard.
                if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                  ev.preventDefault();
                  commit();
                  return;
                }
                // Escape closes the page, matching the rest of the app.
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  commit();
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
    if (list.length === 0) return null;
    return h(
      'div',
      { className: 'nw-toast-wrap', role: 'status', 'aria-live': 'polite' },
      list.map((row) => h('div', { key: row.id, className: 'nw-toast', 'data-kind': row.kind }, row.message)),
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

    let layout = null;
    try {
      layout = ctx.get('layout') || null;
    } catch (err) {
      layout = null;
    }
    NW._layout = layout;
    // Service handles the dialogs need (uiWorkspace for the native folder
    // picker). Stored on NW so any part can reach them without threading props
    // through every component.
    try {
      NW._ctx = ctx;
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