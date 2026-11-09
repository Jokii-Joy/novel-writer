;(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // NW.db — IndexedDB persistence for novels, chapters, history, trash, settings.
  // Database: `novel-writer` v1.
  //   novels   keyPath id
  //   chapters keyPath id
  //   versions keyPath id, index byChapterId
  //   trash    keyPath id
  //   settings keyPath key (single row `app`)
  //
  // Rules: no method may reject because of a missing record; failures resolve to
  // undefined / no-op. Every mutation notifies NW.db.subscribe() listeners.
  // Chapter/version content may be stored ciphertext (`enc:v1:`) and is decrypted
  // transparently on read when a password is unlocked.
  // ---------------------------------------------------------------------------

  const DB_NAME = 'novel-writer';
  // R73: 4 adds `revisions` — the 修改建议 the writer accepted. It is a sibling
  // of `marks` (a record *about* a range of words, never an edit to the text),
  // so an old database upgrades in place without touching existing rows.
  // R77: 5 adds `lore` — 设定集（人物 / 地点 / 道具 / 随手设定），按书存。
  const DB_VERSION = 5;
  const STORES = ['novels', 'chapters', 'versions', 'trash', 'settings', 'notes', 'marks', 'revisions', 'lore'];
  const VERSION_LIMIT = 50;
  const SETTINGS_KEY = 'app';
  const ENC_PREFIX = 'enc:v1:';

  const DEFAULT_SETTINGS = {
    fontFamily: '"Noto Serif SC","Source Han Serif SC","Songti SC",serif',
    fontSize: 20,
    lineHeight: 2,
    pageWidth: 760,
    /**
     * R100: the daily word goal drives the home-screen ring and the status bar.
     * Kept small on purpose — a goal you can hit on a bad day is what makes the
     * next session start; a number that only works on a good day becomes guilt.
     * 0 disables the ring (the plain 「今天 N 字」 stays).
     */
    dailyGoal: 500,
    /* 'claude' | 'eye' | 'night' | 'newspaper' | 'magazine' — five themes since
       R19; retired ids (light/harness/card/ink/dark/parchment/guofeng) are
       migrated on load by 90-app.js migrateTheme() and aliased by 60-editor.js. */
    theme: 'claude',
    typewriter: false,
    immersive: false,
    /**
     * Caret appearance (R11). The editor paints its own caret (.nw-cursor) on top
     * of a transparent native one, so width/colour/blink are plain settings rather
     * than theme internals. `caretColor: ''` means "follow the theme", which is
     * what every reading palette wants; a non-empty value is an explicit override.
     */
    caretWidth: 3,
    caretColor: '',
    caretBlink: true,
    /**
     * R46/R54: fade every line except the one being written. `focusDim` is the
     * switch. On by default because it is the whole point of a writing
     * surface — the paragraph under the caret in front, the rest of the page
     * quiet behind it. R54: it used to be immersive-only; it now applies in
     * both modes, so the setting is the single way out and the value was
     * already right for the writer who asked.
     *
     * R71: `focusLines` was removed with the fixed-height band. The lit region
     * is now the caret's own paragraph, so there is no "lines either side" left
     * to configure. The key is simply absent; an old stored value is ignored
     * (mergeSettings keeps unknown keys but nothing reads this one).
     */
    focusDim: true,
    autoSaveMs: 1200,
    /**
     * R16 ⑥: whether 字数 counts punctuation marks. Chinese word processors count
     * them, so this ships on; turning it off drops the marks from the status bar,
     * the book totals and the submission preview alike (the host reads the same
     * setting, so the two halves cannot disagree).
     */
    countPunctuation: true,
    /**
     * R29: one model per AI job. Each of the three is an independent
     * `provider` + `model` pair so the writer can run proofreading on a cheap
     * model and the editorial advice on a strong one; `null` means "follow the
     * harness default", which is what a fresh library gets.
     */
    proofreadProvider: null,
    proofreadModel: null,
    /** R29: the writer's own proofreading brief; '' = use the shipped default. */
    proofreadRules: '',
    submitProvider: null,
    submitModel: null,
    adviceProvider: null,
    adviceModel: null,
    autoLockMinutes: 15,
    lockEnabled: false,
    encryption: false,
    exportFormat: 'docx',
    /** Fixed text appended to the end of every exported document. */
    exportSignature: '',
    /** Whether exportSignature is appended by default. */
    exportSignatureOn: false,
    /** Include the title/author header in exported documents. */
    exportIncludeMeta: true,
    /** Absolute path of the user's on-disk library directory ('' = not set). */
    libraryDir: '',
    /** Mirror the whole library into libraryDir on every save. */
    libraryMirror: false,
    /** Encrypt mirrored files as .nwe (AES-256-GCM, key derived from the host key). */
    libraryEncrypt: false,
    /** Submission defaults (populated by the 投稿 dialog, kept for convenience). */
    penName: '',
    contactEmail: '',
    contactInfo: '',
    backup: { kind: 'none', autoSync: false, lastSync: 0 },
    shortcuts: {},
  };

  let dbPromise = null;
  let subscribers = [];
  /** Keeps version timestamps strictly increasing even inside one millisecond. */
  let lastVersionStamp = 0;
  /**
   * Read-modify-write serialisation. Two saves issued in the same tick would
   * otherwise both read the same snapshot and the later write would drop the
   * earlier patch (settings silently reverting, sibling chapters sharing an
   * `order`). Every stored mutation that depends on a prior read goes through
   * one of these chains, so callers can stay fire-and-forget.
   */
  let settingsChain = Promise.resolve();
  let chapterCreateChain = Promise.resolve();

  function serialise(chainKey, task) {
    const previous = chainKey === 'settings' ? settingsChain : chapterCreateChain;
    const next = previous.then(task, task);
    // Keep the chain alive even if this task threw: the next caller still runs.
    const settle = () => undefined;
    if (chainKey === 'settings') settingsChain = next.then(settle, settle);
    else chapterCreateChain = next.then(settle, settle);
    return next;
  }

  // ------------------------------- helpers ----------------------------------

  function uid(prefix) {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return prefix + '_' + crypto.randomUUID();
      }
    } catch (err) {
      /* fall through */
    }
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function now() {
    return Date.now();
  }

  function nextVersionStamp() {
    const stamp = Math.max(Date.now(), lastVersionStamp + 1);
    lastVersionStamp = stamp;
    return stamp;
  }

  function notify() {
    const list = subscribers.slice();
    for (let i = 0; i < list.length; i += 1) {
      try {
        list[i]();
      } catch (err) {
        /* a broken subscriber must not break persistence */
      }
    }
  }

  function indexDb() {
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB) return indexedDB;
    } catch (err) {
      /* ignore */
    }
    try {
      if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const idb = indexDb();
      if (!idb) {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      let request;
      try {
        request = idb.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('无法打开数据库'));
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('novels')) db.createObjectStore('novels', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('versions')) {
            const store = db.createObjectStore('versions', { keyPath: 'id' });
            store.createIndex('byChapterId', 'chapterId', { unique: false });
          }
          if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
          // R10: quick notes ("灵感"). Separate store so a note never shares a
          // lifecycle with the manuscript, and so an old database upgrades in
          // place without touching existing rows.
          if (!db.objectStoreNames.contains('notes')) {
            const store = db.createObjectStore('notes', { keyPath: 'id' });
            store.createIndex('byNovelId', 'novelId', { unique: false });
          }
          // R47: annotations (下划线 / 删除线 / 批注) are marks over a chapter's
          // text, not edits to it — the manuscript itself must stay byte for
          // byte what the writer typed. So they get their own store keyed by
          // chapter, the same shape `notes` uses, and an old database upgrades
          // in place without touching existing rows.
          if (!db.objectStoreNames.contains('marks')) {
            const store = db.createObjectStore('marks', { keyPath: 'id' });
            store.createIndex('byChapterId', 'chapterId', { unique: false });
            store.createIndex('byNovelId', 'novelId', { unique: false });
          }
          // R73: 已接收的修改建议. Same shape of record as a mark — it points at a
          // range of the chapter — but it is the *history of advice the writer
          // said yes to*, so it needs its own store: deleting a mark must not
          // delete an accepted suggestion, and vice versa.
          if (!db.objectStoreNames.contains('revisions')) {
            const store = db.createObjectStore('revisions', { keyPath: 'id' });
            store.createIndex('byChapterId', 'chapterId', { unique: false });
            store.createIndex('byNovelId', 'novelId', { unique: false });
          }
          // R77: 设定集. One row per card, scoped to a book (not a chapter) —
          // a character exists across the whole novel, not inside one scene.
          if (!db.objectStoreNames.contains('lore')) {
            const store = db.createObjectStore('lore', { keyPath: 'id' });
            store.createIndex('byNovelId', 'novelId', { unique: false });
          }
        } catch (err) {
          try {
            request.transaction.abort();
          } catch (e) {
            /* ignore */
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          db.onversionchange = () => {
            try {
              db.close();
            } catch (err) {
              /* ignore */
            }
            dbPromise = null;
          };
        } catch (err) {
          /* ignore */
        }
        resolve(db);
      };
      request.onerror = () => {
        reject(request.error instanceof Error ? request.error : new Error('打开数据库失败'));
      };
      request.onblocked = () => {
        /* another tab holds an older version — keep waiting */
      };
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  /** Reads one record. Resolves undefined when absent or on any failure. */
  function readOne(storeName, key) {
    return openDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            tx.onabort = () => reject(tx.error || new Error('读取中止'));
          }),
      )
      .catch(() => undefined);
  }

  /** Reads every record of a store. Resolves [] on failure. */
  function readAll(storeName) {
    return openDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            tx.onabort = () => reject(tx.error || new Error('读取中止'));
          }),
      )
      .catch(() => []);
  }

  function readIndex(storeName, indexName, key) {
    return openDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).index(indexName).getAll(key);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            tx.onabort = () => reject(tx.error || new Error('读取中止'));
          }),
      )
      .catch(() => []);
  }

  /**
   * Runs a batch of synchronous operations inside one transaction.
   * ops: [{store, type:'put'|'delete'|'clear', value?, key?}]
   */
  function writeBatch(ops) {
    if (!ops || ops.length === 0) return Promise.resolve(true);
    return openDb()
      .then(
        (db) =>
          new Promise((resolve, reject) => {
            const names = [];
            for (let i = 0; i < ops.length; i += 1) {
              if (names.indexOf(ops[i].store) < 0) names.push(ops[i].store);
            }
            const tx = db.transaction(names, 'readwrite');
            let failed = null;
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(failed || tx.error || new Error('写入失败'));
            tx.onabort = () => reject(failed || tx.error || new Error('写入中止'));
            try {
              for (let i = 0; i < ops.length; i += 1) {
                const op = ops[i];
                const store = tx.objectStore(op.store);
                if (op.type === 'put') store.put(op.value);
                else if (op.type === 'delete') store.delete(op.key);
                else if (op.type === 'clear') store.clear();
                else throw new Error('未知操作 ' + String(op.type));
              }
            } catch (err) {
              failed = err;
              try {
                tx.abort();
              } catch (e) {
                /* ignore */
              }
            }
          }),
      )
      .catch(() => false);
  }

  async function encryptionActive() {
    try {
      if (!NW.crypto || typeof NW.crypto.encryptionOn !== 'function') return false;
      return !!(await NW.crypto.encryptionOn());
    } catch (err) {
      return false;
    }
  }

  function isCipher(value) {
    return typeof value === 'string' && value.slice(0, ENC_PREFIX.length) === ENC_PREFIX;
  }

  /** Encrypts when encryption is active; returns the value to persist. */
  async function sealContent(content) {
    const text = content == null ? '' : String(content);
    if (!text) return '';
    if (isCipher(text)) return text;
    try {
      if (await encryptionActive()) return await NW.crypto.encryptText(text);
    } catch (err) {
      /* encryption unavailable — fall back to plaintext rather than losing the write */
    }
    return text;
  }

  /**
   * Rewrites every stored chapter/version body as ciphertext. Used when a
   * password is set, when the studio locks, or when "正文加密存储" is turned on.
   * Rows that are already ciphertext (or empty) are left untouched, so this is
   * idempotent. Requires an unlocked crypto session; returns the rows rewritten.
   */
  async function encryptAll() {
    // R99: share the chapter write chain. This read-all → encrypt-all →
    // write-all sequence used to run beside a flush that was still in flight,
    // and the whole-row put could restore the pre-flush body over the text the
    // editor had just saved.
    return serialise('chapter', encryptAllUnlocked);
  }

  async function encryptAllUnlocked() {
    try {
      if (!NW.crypto || typeof NW.crypto.encryptText !== 'function') return 0;
      if (typeof NW.crypto.isUnlocked === 'function' && !NW.crypto.isUnlocked()) return 0;
      const stores = ['chapters', 'versions'];
      const ops = [];
      for (let s = 0; s < stores.length; s += 1) {
        const rows = await readAll(stores[s]);
        for (let i = 0; i < (rows || []).length; i += 1) {
          const row = rows[i];
          const text = row && row.content;
          if (typeof text !== 'string' || !text || isCipher(text)) continue;
          let sealed = '';
          try {
            sealed = await NW.crypto.encryptText(text);
          } catch (err) {
            /* skip this row: never drop content because of a crypto hiccup */
            continue;
          }
          if (!isCipher(sealed)) continue;
          ops.push({ store: stores[s], type: 'put', value: Object.assign({}, row, { content: sealed }) });
        }
      }
      if (!ops.length) return 0;
      const ok = await writeBatch(ops);
      if (!ok) return 0;
      notify();
      return ops.length;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Rewrites every stored body back to plaintext. Must run while the crypto
   * session is still unlocked (i.e. BEFORE the password is cleared) — after
   * that the key is gone and ciphertext can never be opened again. Rows whose
   * ciphertext does not decrypt are left as they are rather than blanked.
   */
  async function decryptAll() {
    // R99: see encryptAll — same chain, same reason.
    return serialise('chapter', decryptAllUnlocked);
  }

  async function decryptAllUnlocked() {
    try {
      if (!NW.crypto || typeof NW.crypto.decryptText !== 'function') return 0;
      if (typeof NW.crypto.isUnlocked === 'function' && !NW.crypto.isUnlocked()) return 0;
      const stores = ['chapters', 'versions'];
      const ops = [];
      for (let s = 0; s < stores.length; s += 1) {
        const rows = await readAll(stores[s]);
        for (let i = 0; i < (rows || []).length; i += 1) {
          const row = rows[i];
          const text = row && row.content;
          if (!isCipher(text)) continue;
          let plain = null;
          try {
            plain = await NW.crypto.decryptText(text);
          } catch (err) {
            continue; // keep the ciphertext: better unreadable than lost
          }
          if (typeof plain !== 'string') continue;
          ops.push({ store: stores[s], type: 'put', value: Object.assign({}, row, { content: plain }) });
        }
      }
      if (!ops.length) return 0;
      const ok = await writeBatch(ops);
      if (!ok) return 0;
      notify();
      return ops.length;
    } catch (err) {
      return 0;
    }
  }

  /** Decrypts ciphertext; returns '' when locked/corrupt so plaintext never leaks. */
  async function openContent(value, flagBucket, label) {
    if (typeof value !== 'string' || !isCipher(value)) return value == null ? '' : value;
    try {
      if (!NW.crypto || typeof NW.crypto.decryptText !== 'function') throw new Error('crypto 不可用');
      return await NW.crypto.decryptText(value);
    } catch (err) {
      if (flagBucket) flagBucket.locked = true;
      try {
        if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
          console.warn('[novel-writer] 解密失败，内容按空串处理：' + String(label || 'unknown'));
        }
      } catch (e) {
        /* ignore */
      }
      return '';
    }
  }

  function countWords(text) {
    try {
      if (NW.format && typeof NW.format.wordCount === 'function') return NW.format.wordCount(text);
    } catch (err) {
      /* fall through */
    }
    return String(text == null ? '' : text).replace(/\s+/g, '').length;
  }

  async function hydrateChapter(record) {
    if (!record) return record;
    const flag = {};
    const content = await openContent(record.content, flag, record.id);
    const out = Object.assign({}, record, { content: content });
    // wordCount always present: stored value when known, otherwise recomputed
    // from the plaintext (older records and locked chapters).
    const stored = Number(out.wordCount);
    out.wordCount = Number.isFinite(stored) && stored >= 0 ? stored : countWords(content);
    if (flag.locked) out.locked = true;
    return out;
  }

  async function hydrateVersion(record) {
    if (!record) return record;
    const flag = {};
    const content = await openContent(record.content, flag, record.id);
    const out = Object.assign({}, record, { content: content });
    const stored = Number(out.words);
    out.words = Number.isFinite(stored) && stored >= 0 ? stored : countWords(content);
    if (flag.locked) out.locked = true;
    return out;
  }

  /** Chapter metadata without the (possibly huge, possibly encrypted) body. */
  function stripContent(record) {
    const out = Object.assign({}, record);
    out.content = '';
    const stored = Number(out.wordCount);
    out.wordCount = Number.isFinite(stored) && stored >= 0 ? stored : 0;
    return out;
  }

  // -------------------------------- novels ----------------------------------

  async function listNovels() {
    const rows = await readAll('novels');
    return rows
      .filter(function (row) {
        return row && row.id;
      })
      .sort(function (a, b) {
        return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      });
  }

  async function getNovel(id) {
    if (!id) return undefined;
    return readOne('novels', id);
  }

  async function createNovel(input) {
    const data = input || {};
    const title = String(data.title == null ? '' : data.title).trim() || '未命名小说';
    const stamp = now();
    const novel = {
      id: uid('novel'),
      title: title,
      author: String(data.author == null ? '' : data.author).trim(),
      description: String(data.description == null ? '' : data.description),
      cover: data.cover == null ? null : data.cover,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const ok = await writeBatch([{ store: 'novels', type: 'put', value: novel }]);
    if (!ok) throw new Error('创建小说失败');
    notify();
    return novel;
  }

  async function updateNovel(id, patch) {
    if (!id || !patch) return undefined;
    const current = await readOne('novels', id);
    if (!current) return undefined;
    const next = Object.assign({}, current);
    const fields = ['title', 'author', 'description', 'cover'];
    for (let i = 0; i < fields.length; i += 1) {
      const key = fields[i];
      if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    }
    next.updatedAt = now();
    const ok = await writeBatch([{ store: 'novels', type: 'put', value: next }]);
    if (!ok) return undefined;
    notify();
    return next;
  }

  async function deleteNovel(id) {
    if (!id) return;
    const novel = await readOne('novels', id);
    if (!novel) return;
    const allChapters = await readAll('chapters');
    const chapters = allChapters.filter(function (row) {
      return row && row.novelId === id;
    });
    const allVersions = await readAll('versions');
    const chapterIds = {};
    for (let i = 0; i < chapters.length; i += 1) chapterIds[chapters[i].id] = true;
    const versions = allVersions.filter(function (row) {
      return row && chapterIds[row.chapterId];
    });

    const trashItem = {
      id: uid('trash'),
      kind: 'novel',
      title: novel.title || '未命名小说',
      deletedAt: now(),
      payload: { novel: novel, chapters: chapters, versions: versions },
    };

    const ops = [{ store: 'trash', type: 'put', value: trashItem }, { store: 'novels', type: 'delete', key: id }];
    for (let i = 0; i < chapters.length; i += 1) {
      ops.push({ store: 'chapters', type: 'delete', key: chapters[i].id });
    }
    for (let i = 0; i < versions.length; i += 1) {
      ops.push({ store: 'versions', type: 'delete', key: versions[i].id });
    }
    // R47: same contract as deleteChapter — the book's annotations travel with
    // it into the trash payload so restoring brings them back.
    const allMarks = await readAll('marks');
    const marks = allMarks.filter(function (row) {
      return row && chapterIds[row.chapterId];
    });
    if (marks.length) {
      trashItem.payload.marks = marks;
      for (let i = 0; i < marks.length; i += 1) {
        ops.push({ store: 'marks', type: 'delete', key: marks[i].id });
      }
    }
    // R82: the book's 灵感便签, 设定集 and 已接收建议 go into the same trash item.
    // Without this, deleting a book (or emptying the trash) left those rows
    // orphaned forever, and restoring the book brought back the text but not the
    // notes/lore/decisions that belonged to it.
    const allNotes = await readAll('notes');
    const notes = allNotes.filter(function (row) {
      return row && (chapterIds[row.chapterId] || row.novelId === id);
    });
    if (notes.length) {
      trashItem.payload.notes = notes;
      for (let i = 0; i < notes.length; i += 1) {
        ops.push({ store: 'notes', type: 'delete', key: notes[i].id });
      }
    }
    const allLore = await readAll('lore');
    const lore = allLore.filter(function (row) {
      return row && row.novelId === id;
    });
    if (lore.length) {
      trashItem.payload.lore = lore;
      for (let i = 0; i < lore.length; i += 1) {
        ops.push({ store: 'lore', type: 'delete', key: lore[i].id });
      }
    }
    const allRevisions = await readAll('revisions');
    const revisions = allRevisions.filter(function (row) {
      return row && chapterIds[row.chapterId];
    });
    if (revisions.length) {
      trashItem.payload.revisions = revisions;
      for (let i = 0; i < revisions.length; i += 1) {
        ops.push({ store: 'revisions', type: 'delete', key: revisions[i].id });
      }
    }
    await writeBatch(ops);
    notify();
    // R22: same contract as deleteChapter — the id lets the caller offer 撤销.
    return trashItem.id;
  }

  // -------------------------------- chapters --------------------------------

  function chapterSort(a, b) {
    const oa = Number(a.order) || 0;
    const ob = Number(b.order) || 0;
    if (oa !== ob) return oa - ob;
    return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  }

  /** Depth-first document order: roots by `order`, then each node's children. */
  function orderChapters(rows) {
    const roots = [];
    const children = {};
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const parent = row.parentId == null ? null : String(row.parentId);
      if (parent == null) roots.push(row);
      else {
        if (!children[parent]) children[parent] = [];
        children[parent].push(row);
      }
    }
    roots.sort(chapterSort);
    const keyList = Object.keys(children);
    for (let i = 0; i < keyList.length; i += 1) children[keyList[i]].sort(chapterSort);

    const out = [];
    const seen = {};
    const walk = (row) => {
      if (!row || seen[row.id]) return; // guards corrupt/cyclic parent chains
      seen[row.id] = true;
      out.push(row);
      const kids = children[String(row.id)] || [];
      for (let i = 0; i < kids.length; i += 1) walk(kids[i]);
    };
    for (let i = 0; i < roots.length; i += 1) walk(roots[i]);
    // orphans whose parent no longer exists, then any cycle leftovers
    const leftovers = [];
    for (let i = 0; i < rows.length; i += 1) if (!seen[rows[i].id]) leftovers.push(rows[i]);
    leftovers.sort(chapterSort);
    for (let i = 0; i < leftovers.length; i += 1) walk(leftovers[i]);
    return out;
  }

  async function listChapters(novelId) {
    const rows = await readAll('chapters');
    const filtered = rows.filter(function (row) {
      if (!row || !row.id) return false;
      if (novelId == null) return true;
      return row.novelId === novelId;
    });
    const ordered = orderChapters(filtered);
    const out = [];
    for (let i = 0; i < ordered.length; i += 1) {
      out.push(await hydrateChapter(ordered[i]));
    }
    return out;
  }

  async function getChapter(id) {
    if (!id) return undefined;
    const record = await readOne('chapters', id);
    if (!record) return undefined;
    return hydrateChapter(record);
  }

  /** Every chapter of every novel, metadata only (no content) — for backup/search. */
  async function listAllChapters() {
    const rows = await readAll('chapters');
    const ordered = orderChapters(
      rows.filter(function (row) {
        return row && row.id;
      }),
    );
    return ordered.map(stripContent);
  }

  async function createChapter(novelId, input) {
    const data = input || {};
    if (!novelId) throw new Error('缺少小说 ID');
    // Serialised: creating chapters back-to-back used to read the same sibling
    // list twice and hand out identical `order` values, which later made
    // moveChapter() reorder the wrong rows.
    return serialise('chapter', async function () {
      const siblings = (await readAll('chapters')).filter(function (row) {
        return row && row.novelId === novelId && (row.parentId == null ? null : row.parentId) === (data.parentId == null ? null : data.parentId);
      });
      let maxOrder = -1;
      for (let i = 0; i < siblings.length; i += 1) {
        const value = Number(siblings[i].order);
        if (Number.isFinite(value) && value > maxOrder) maxOrder = value;
      }
      const stamp = now();
      const chapter = {
        id: uid('chapter'),
        novelId: novelId,
        parentId: data.parentId == null ? null : data.parentId,
        title: String(data.title == null ? '' : data.title).trim() || '未命名章节',
        content: '',
        order: maxOrder + 1,
        createdAt: stamp,
        updatedAt: stamp,
        wordCount: 0,
      };
      const ok = await writeBatch([{ store: 'chapters', type: 'put', value: chapter }]);
      if (!ok) throw new Error('创建章节失败');
      await touchNovel(novelId);
      notify();
      return chapter;
    });
  }

  async function touchNovel(novelId) {
    if (!novelId) return;
    const novel = await readOne('novels', novelId);
    if (!novel) return;
    const next = Object.assign({}, novel, { updatedAt: now() });
    await writeBatch([{ store: 'novels', type: 'put', value: next }]);
  }

  /**
   * R81: create many chapters (with their text) in ONE transaction.
   *
   * `importNow` used to call `createChapter` per row, and that function reads the
   * whole `chapters` table to find the next `order` — a 1000-chapter epub meant
   * half a million row decodes and a freeze on the import screen. This reads the
   * table once, seals each body, and writes everything in a single batch.
   */
  async function createChapters(novelId, entries) {
    if (!novelId) throw new Error('缺少小说 ID');
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!list.length) return [];
    return serialise('chapter', async function () {
      const siblings = (await readAll('chapters')).filter(function (row) {
        return row && row.novelId === novelId;
      });
      let maxOrder = -1;
      for (let i = 0; i < siblings.length; i += 1) {
        const value = Number(siblings[i].order);
        if (Number.isFinite(value) && value > maxOrder) maxOrder = value;
      }
      const stamp = now();
      const created = [];
      const ops = [];
      for (let i = 0; i < list.length; i += 1) {
        const data = list[i] || {};
        const text = String(data.content == null ? '' : data.content);
        const words =
          NW.format && typeof NW.format.wordCount === 'function'
            ? NW.format.wordCount(text)
            : text.replace(/\s+/g, '').length;
        const chapter = {
          id: uid('chapter'),
          novelId: novelId,
          parentId: data.parentId == null ? null : data.parentId,
          title: String(data.title == null ? '' : data.title).trim() || '未命名章节',
          content: await sealContent(text),
          order: maxOrder + 1 + i,
          createdAt: stamp,
          updatedAt: stamp,
          wordCount: words,
        };
        created.push(chapter);
        ops.push({ store: 'chapters', type: 'put', value: chapter });
      }
      const ok = await writeBatch(ops);
      if (!ok) throw new Error('创建章节失败');
      await touchNovel(novelId);
      notify();
      return created;
    });
  }

  async function updateChapter(id, patch) {
    // R81: this and `saveChapterContent` both rewrite the whole row, and the
    // edit→save path runs on a 1.2s debounce. Without the same queue the chapter
    // creator uses, a rename that read the row before a save could write its old
    // `content` back afterwards (the audit's 「改名把正文写回旧版本」).
    return serialise('chapter', function () {
      return updateChapterUnlocked(id, patch);
    });
  }

  async function updateChapterUnlocked(id, patch) {
    if (!id || !patch) return undefined;
    const current = await readOne('chapters', id);
    if (!current) return undefined;
    const next = Object.assign({}, current);
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      next.title = String(patch.title == null ? '' : patch.title).trim() || '未命名章节';
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'parentId')) {
      next.parentId = patch.parentId == null ? null : patch.parentId;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'order')) {
      const order = Number(patch.order);
      if (Number.isFinite(order)) next.order = order;
    }
    // R77: 写作状态 / 一句话简介 / 本章目标. All three are optional and unknown
    // values are ignored rather than stored, so an older row keeps behaving.
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const status = String(patch.status || '');
      if (status === 'draft' || status === 'revising' || status === 'done') next.status = status;
      else delete next.status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'summary')) {
      const summary = String(patch.summary == null ? '' : patch.summary).trim().slice(0, 200);
      if (summary) next.summary = summary;
      else delete next.summary;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'targetWords')) {
      const target = Math.round(Number(patch.targetWords) || 0);
      if (target > 0) next.targetWords = Math.min(target, 1000000);
      else delete next.targetWords;
    }
    next.updatedAt = now();
    const ok = await writeBatch([{ store: 'chapters', type: 'put', value: next }]);
    if (!ok) return undefined;
    if (next.novelId) await touchNovel(next.novelId);
    notify();
    return hydrateChapter(next);
  }

  /** Moves a chapter under `parentId` at `orderIndex`, renumbering its new siblings. */
  async function moveChapter(id, parentId, orderIndex) {
    if (!id) return;
    // Two quick drags used to read the same sibling list and renumber every row
    // from it, leaving duplicate `order` values behind; the same queue that
    // guards createChapter keeps the second drag working from the first result.
    return serialise('chapter', async function () {
      await moveChapterUnlocked(id, parentId, orderIndex);
    });
  }

  async function moveChapterUnlocked(id, parentId, orderIndex) {
    const current = await readOne('chapters', id);
    if (!current) return;
    const targetParent = parentId == null ? null : parentId;
    if (targetParent === id) return; // never parent a chapter to itself

    const all = await readAll('chapters');
    const novelId = current.novelId;
    // refuse to re-parent a chapter under one of its own descendants
    const descendants = collectDescendants(all, id);
    if (descendants.indexOf(targetParent) >= 0) return;

    const siblings = all.filter(function (row) {
      return (
        row &&
        row.id &&
        row.novelId === novelId &&
        row.id !== id &&
        (row.parentId == null ? null : row.parentId) === targetParent
      );
    });
    siblings.sort(chapterSort);

    const requested = Number(orderIndex);
    const insertAt = Number.isFinite(requested)
      ? Math.max(0, Math.min(siblings.length, Math.floor(requested)))
      : siblings.length;

    const ordered = siblings.slice();
    ordered.splice(insertAt, 0, Object.assign({}, current, { parentId: targetParent, updatedAt: now() }));

    const ops = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const row = ordered[i];
      if (Number(row.order) !== i || row.id === id) {
        ops.push({ store: 'chapters', type: 'put', value: Object.assign({}, row, { order: i }) });
      }
    }
    await writeBatch(ops);
    if (novelId) await touchNovel(novelId);
    notify();
  }

  /** Ids of every descendant of `rootId` (never includes rootId), cycle-safe. */
  function collectDescendants(rows, rootId) {
    const byParent = {};
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || !row.id) continue;
      const key = row.parentId == null ? '\u0000root' : String(row.parentId);
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(row);
    }
    const out = [];
    const seen = {};
    seen[rootId] = true;
    const queue = [rootId];
    while (queue.length) {
      const parent = queue.shift();
      const kids = byParent[String(parent)] || [];
      for (let i = 0; i < kids.length; i += 1) {
        const kid = kids[i];
        if (!kid || seen[kid.id]) continue;
        seen[kid.id] = true;
        out.push(kid.id);
        queue.push(kid.id);
      }
    }
    return out;
  }

  async function deleteChapter(id) {
    if (!id) return;
    const all = await readAll('chapters');
    const root = all.filter(function (row) {
      return row && row.id === id;
    })[0];
    if (!root) return;

    const sameNovel = all.filter(function (row) {
      return row && row.id && row.novelId === root.novelId;
    });
    const doomedIds = [id].concat(collectDescendants(sameNovel, id));
    const idSet = {};
    for (let i = 0; i < doomedIds.length; i += 1) idSet[doomedIds[i]] = true;
    const doomed = sameNovel.filter(function (row) {
      return idSet[row.id];
    });

    const allVersions = await readAll('versions');
    const versions = allVersions.filter(function (row) {
      return row && idSet[row.chapterId];
    });

    const trashItem = {
      id: uid('trash'),
      kind: 'chapter',
      title: root.title || '未命名章节',
      deletedAt: now(),
      payload: { chapter: root, chapters: doomed, versions: versions, novelId: root.novelId },
    };

    const ops = [{ store: 'trash', type: 'put', value: trashItem }];
    for (let i = 0; i < doomed.length; i += 1) {
      ops.push({ store: 'chapters', type: 'delete', key: doomed[i].id });
    }
    for (let i = 0; i < versions.length; i += 1) {
      ops.push({ store: 'versions', type: 'delete', key: versions[i].id });
    }
    // R47: annotations live on character offsets inside these chapters, so they
    // go with them. Parked in the trash payload rather than deleted outright:
    // 撤销 puts the text back, and an underline that reappears with it costs
    // nothing while a silently lost one is a small betrayal of the writer.
    const allMarks = await readAll('marks');
    const marks = allMarks.filter(function (row) {
      return row && idSet[row.chapterId];
    });
    if (marks.length) {
      trashItem.payload.marks = marks;
      for (let i = 0; i < marks.length; i += 1) {
        ops.push({ store: 'marks', type: 'delete', key: marks[i].id });
      }
    }
    // R82: 灵感便签 and 已接收建议 point at this chapter too. Deleting the chapter
    // used to leave them behind as unreachable orphans (and an undone delete
    // silently kept them). Park them in the same trash item.
    const allNotes = await readAll('notes');
    const notes = allNotes.filter(function (row) {
      return row && idSet[row.chapterId];
    });
    if (notes.length) {
      trashItem.payload.notes = notes;
      for (let i = 0; i < notes.length; i += 1) {
        ops.push({ store: 'notes', type: 'delete', key: notes[i].id });
      }
    }
    const allRevisions = await readAll('revisions');
    const revisions = allRevisions.filter(function (row) {
      return row && idSet[row.chapterId];
    });
    if (revisions.length) {
      trashItem.payload.revisions = revisions;
      for (let i = 0; i < revisions.length; i += 1) {
        ops.push({ store: 'revisions', type: 'delete', key: revisions[i].id });
      }
    }
    await writeBatch(ops);
    if (root.novelId) await touchNovel(root.novelId);
    notify();
    // R22: hand the trash id back so the UI can offer 撤销 on the toast. The
    // row already sits in 回收站, but nobody wants to open a dialog to undo a
    // mis-click.
    return trashItem.id;
  }

  function saveChapterContent(id, content) {
    // R81: serialised with chapter creation / renames / moves (see updateChapter).
    return serialise('chapter', function () {
      return saveChapterContentUnlocked(id, content);
    });
  }

  async function saveChapterContentUnlocked(id, content) {
    if (!id) return;
    const current = await readOne('chapters', id);
    if (!current) return;
    const text = content == null ? '' : String(content);
    // Data-loss guard. While the key is cold the stored ciphertext cannot be
    // opened by anyone, so *any* write is either a downgrade of that ciphertext
    // to plaintext (the exact bug seen when the editor unmounts right after
    // lock() and flushes its plaintext buffer) or an erase when the reader saw
    // ''. Both are refused; the row keeps its ciphertext and the next unlock
    // shows the real text. With the key present an empty buffer is a legitimate
    // "clear the chapter" action and must go through.
    const keyCold = !(NW.crypto && typeof NW.crypto.isUnlocked === 'function' && NW.crypto.isUnlocked());
    if (keyCold && isCipher(current.content)) {
      try {
        if (typeof console !== 'undefined' && console && console.warn) {
          console.warn('[novel-writer] 已锁定，拒绝用明文/空内容覆盖密文：' + String(id));
        }
      } catch (e) {
        /* ignore */
      }
      return;
    }
    const stored = await sealContent(text);
    // The guard above reads the key once; the lock can land before this write
    // lands. sealContent then falls back to plaintext on purpose (it refuses to
    // lose a write), which here would replace an unreadable-but-intact ciphertext
    // with readable text — a silent downgrade of the very thing the password
    // protects. Shape beats intent: a ciphertext row stays one.
    if (isCipher(current.content) && !isCipher(stored)) {
      try {
        if (typeof console !== 'undefined' && console && console.warn) {
          console.warn('[novel-writer] 加密状态在保存过程中变化，已放弃这次写入以保住密文：' + String(id));
        }
      } catch (e) {
        /* ignore */
      }
      return;
    }
    const words =
      NW.format && typeof NW.format.wordCount === 'function'
        ? NW.format.wordCount(text)
        : text.replace(/\s+/g, '').length;
    const next = Object.assign({}, current, {
      content: stored,
      wordCount: words,
      updatedAt: now(),
    });
    const ok = await writeBatch([{ store: 'chapters', type: 'put', value: next }]);
    // A failed write must not look like a save. The editor and the status bar key
    // 「已保存」 off this call resolving, and `writeBatch` turns every IndexedDB
    // failure (quota, a closed connection after `onversionchange`, an aborted
    // transaction) into `false`. Returning quietly here left the new text in
    // memory only: switching chapters or reloading lost it while the UI still
    // said 已保存. Throwing lands in `saveChapter`'s catch, which sets 'error'.
    if (!ok) throw new Error('保存正文失败：IndexedDB 写入未完成');
    if (next.novelId) await touchNovel(next.novelId);
    notify();
  }

  // -------------------------------- history ----------------------------------

  async function saveVersion(chapterId, content) {
    if (!chapterId) return;
    const text = content == null ? '' : String(content);
    const stored = await sealContent(text);
    const words =
      NW.format && typeof NW.format.wordCount === 'function'
        ? NW.format.wordCount(text)
        : text.replace(/\s+/g, '').length;
    const version = {
      id: uid('ver'),
      chapterId: chapterId,
      content: stored,
      words: words,
      createdAt: nextVersionStamp(),
    };
    const ok = await writeBatch([{ store: 'versions', type: 'put', value: version }]);
    if (!ok) return;

    // keep only the newest VERSION_LIMIT entries for this chapter
    const existing = await readIndex('versions', 'byChapterId', chapterId);
    if (existing.length > VERSION_LIMIT) {
      existing.sort(function (a, b) {
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      });
      const ops = [];
      for (let i = VERSION_LIMIT; i < existing.length; i += 1) {
        ops.push({ store: 'versions', type: 'delete', key: existing[i].id });
      }
      if (ops.length) await writeBatch(ops);
    }
    notify();
  }

  async function listVersions(chapterId) {
    if (!chapterId) return [];
    const rows = await readIndex('versions', 'byChapterId', chapterId);
    rows.sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      out.push(await hydrateVersion(rows[i]));
    }
    return out;
  }

  async function getVersion(id) {
    if (!id) return undefined;
    const record = await readOne('versions', id);
    if (!record) return undefined;
    return hydrateVersion(record);
  }

  // --------------------------------- trash -----------------------------------

  async function listTrash() {
    const rows = await readAll('trash');
    return rows
      .filter(function (row) {
        return row && row.id;
      })
      .sort(function (a, b) {
        return (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0);
      });
  }

  async function restoreTrash(id) {
    if (!id) return;
    const item = await readOne('trash', id);
    if (!item) return;
    const payload = item.payload || {};
    const ops = [];

    if (item.kind === 'novel') {
      // Restoring must be a deliberate resurrection, not just a re-insert of the
      // old row: the sync engine decides tombstone-vs-live by timestamp, and the
      // peer still carries the tombstone stamped at deletion time. Re-using the
      // book's original `updatedAt` would therefore lose the merge and delete
      // the book again on the next sync tick.
      if (payload.novel) {
        ops.push({ store: 'novels', type: 'put', value: Object.assign({}, payload.novel, { updatedAt: now() }) });
      }
      const chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
      for (let i = 0; i < chapters.length; i += 1) {
        ops.push({ store: 'chapters', type: 'put', value: chapters[i] });
      }
      const versions = Array.isArray(payload.versions) ? payload.versions : [];
      for (let i = 0; i < versions.length; i += 1) {
        ops.push({ store: 'versions', type: 'put', value: versions[i] });
      }
    } else {
      const chapters = Array.isArray(payload.chapters)
        ? payload.chapters
        : payload.chapter
          ? [payload.chapter]
          : [];
      for (let i = 0; i < chapters.length; i += 1) {
        ops.push({ store: 'chapters', type: 'put', value: chapters[i] });
      }
      const versions = Array.isArray(payload.versions) ? payload.versions : [];
      for (let i = 0; i < versions.length; i += 1) {
        ops.push({ store: 'versions', type: 'put', value: versions[i] });
      }
    }

    ops.push({ store: 'trash', type: 'delete', key: id });
    // R47: annotations ride along with the text they were drawn on. Older trash
    // rows simply have no `marks` array, which restores exactly as before.
    const restoredMarks = Array.isArray(payload.marks) ? payload.marks : [];
    for (let i = 0; i < restoredMarks.length; i += 1) {
      const row = restoredMarks[i];
      if (!row || !row.id) continue;
      ops.push({ store: 'marks', type: 'put', value: row });
    }
    // R82: 灵感便签 / 设定集 / 已接收建议 travel with the trash payload too, so
    // deleting a book and undoing it no longer leaves those rows orphaned (or
    // loses them when the trash is emptied).
    for (const key of ['notes', 'lore', 'revisions']) {
      const rows = Array.isArray(payload[key]) ? payload[key] : [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || !row.id) continue;
        ops.push({ store: key, type: 'put', value: row });
      }
    }
    await writeBatch(ops);
    notify();
  }

  async function emptyTrash() {
    await writeBatch([{ store: 'trash', type: 'clear' }]);
    notify();
  }

  // -------------------------------- settings ---------------------------------

  function mergeSettings(base, patch) {
    const out = Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = patch[key];
      if (key === 'backup' && value && typeof value === 'object' && !Array.isArray(value)) {
        out.backup = Object.assign({}, base.backup || {}, value);
      } else if (key === 'shortcuts' && value && typeof value === 'object' && !Array.isArray(value)) {
        out.shortcuts = Object.assign({}, base.shortcuts || {}, value);
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  async function getSettings() {
    const row = await readOne('settings', SETTINGS_KEY);
    const stored = row && row.value && typeof row.value === 'object' ? row.value : {};
    return mergeSettings(DEFAULT_SETTINGS, stored);
  }

  /**
   * R80: did this profile ever save settings?
   *
   * `getSettings()` merges the defaults, so it cannot tell "the writer chose
   * these" from "the profile was wiped". The boot sequence uses this to decide
   * whether the host-side copy (`client.state`) should be adopted — losing a
   * theme or a font size to a host reinstall is exactly the complaint this
   * answers.
   */
  async function hasSettings() {
    const row = await readOne('settings', SETTINGS_KEY);
    return Boolean(row && row.value && typeof row.value === 'object');
  }

  async function saveSettings(patch) {
    // Serialised: concurrent patches must both land. Previously two calls in the
    // same tick read the same row, so the second write dropped the first change
    // (e.g. picking a theme and a font size together reverted the theme).
    return serialise('settings', async function () {
      const current = await getSettings();
      const next = mergeSettings(current, patch);
      const ok = await writeBatch([{ store: 'settings', type: 'put', value: { key: SETTINGS_KEY, value: next } }]);
      if (!ok) return current;
      notify();
      return next;
    });
  }

  // --------------------------------- notes ---------------------------------

  /**
   * Quick notes ("灵感") — one-liners the writer jots down while a chapter is
   * open. Kept out of `chapters` on purpose: a note is never part of the
   * manuscript, never counts toward the word total, and never lands in an
   * export. Notes ride along in `dump()`/`replaceAll()` so a folder backup still
   * restores them.
   */
  async function listNotes(novelId, chapterId) {
    const rows = novelId
      ? await readIndex('notes', 'byNovelId', novelId)
      : await readAll('notes');
    // R14 ③: notes are per chapter now. `chapterId` is optional so callers that
    // want the whole book (export, restore, diagnostics) still get everything.
    const wantChapter = chapterId == null ? '' : String(chapterId);
    return (rows || [])
      .filter(function (row) {
        if (!row || !row.id) return false;
        if (!wantChapter) return true;
        return String(row.chapterId || '') === wantChapter;
      })
      .sort(function (a, b) {
        return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      });
  }

  /**
   * R14 ③: one note per chapter, written on every edit.
   *
   * The note is a single text blob keyed by `chapterId`, so switching chapters
   * never mixes two drafts of your thinking. Empty text deletes the row instead
   * of storing an empty one (an empty note would still render as a card).
   */
  async function saveChapterNote(input) {
    const data = input || {};
    const chapterId = String(data.chapterId || '');
    const novelId = String(data.novelId || '');
    const text = String(data.text == null ? '' : data.text);
    if (!chapterId) return undefined;
    const existing = await listNotes(novelId, chapterId);
    const current = existing[0];
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed.trim()) {
      if (current) await deleteNote(current.id);
      return undefined;
    }
    if (current) {
      if (current.text === trimmed) return current;
      const next = Object.assign({}, current, { text: trimmed, updatedAt: now() });
      const ok = await writeBatch([{ store: 'notes', type: 'put', value: next }]);
      if (!ok) throw new Error('保存灵感失败');
      notify();
      return next;
    }
    const stamp = now();
    const note = {
      id: uid('note'),
      novelId: novelId,
      chapterId: chapterId,
      text: trimmed,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const ok = await writeBatch([{ store: 'notes', type: 'put', value: note }]);
    if (!ok) throw new Error('保存灵感失败');
    notify();
    return note;
  }

  async function createNote(input) {
    const data = input || {};
    const text = String(data.text == null ? '' : data.text).trim();
    if (!text) return undefined;
    const stamp = now();
    const note = {
      id: uid('note'),
      novelId: data.novelId ? String(data.novelId) : '',
      chapterId: data.chapterId ? String(data.chapterId) : '',
      text: text,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const ok = await writeBatch([{ store: 'notes', type: 'put', value: note }]);
    if (!ok) throw new Error('保存灵感失败');
    notify();
    return note;
  }

  async function updateNote(id, patch) {
    if (!id || !patch) return undefined;
    const current = await readOne('notes', id);
    if (!current) return undefined;
    const next = Object.assign({}, current);
    if (Object.prototype.hasOwnProperty.call(patch, 'text')) {
      const text = String(patch.text == null ? '' : patch.text).trim();
      if (!text) return undefined;
      next.text = text;
    }
    next.updatedAt = now();
    const ok = await writeBatch([{ store: 'notes', type: 'put', value: next }]);
    if (!ok) return undefined;
    notify();
    return next;
  }

  async function deleteNote(id) {
    if (!id) return false;
    const ok = await writeBatch([{ store: 'notes', type: 'delete', key: id }]);
    if (!ok) return false;
    notify();
    return true;
  }

  // --------------------------------- marks ---------------------------------

  /**
   * R47: annotations.
   *
   * A mark is a range inside one chapter's text — `{start, end}` measured in
   * characters of `chapter.content` — plus a `kind` and, for 批注, a `note`.
   * Marks are deliberately *not* edits: the manuscript keeps the words the
   * writer typed, and a mark is only an overlay drawn behind them. That way
   * annotating can never reflow the sentence, and deleting a mark always
   * restores the page exactly.
   *
   *   kind: 'underline' | 'strike' | 'comment'
   *
   * `strike` is 删除线 — "this paragraph goes" — and is the reason the mark has
   * to be drawn by the editor rather than carried in the text: a struck line
   * still has to count for the word total until the writer deletes it.
   *
   * R48 dropped the fourth kind (待改). Three marks are enough to say what a
   * writer actually says to themselves — "this line is good", "this line goes",
   * "here is why" — and the extra kind only made the toolbar one button longer.
   * Rows written by R47 keep working: `todo` is normalised to `underline`
   * rather than rejected, so no annotation disappears from an older shelf.
   *
   * R53e: 文字只属于批注. `note` is not a free-floating extra that any kind may
   * carry — it *is* what makes a mark a comment. A row with words in `note` is
   * stored as `comment` whatever kind was asked for, so a range can no longer
   * be an underline and a comment at the same time (that double identity is
   * what made 下划线 and 批注 look like two names for one thing). Rows written
   * before this keep their note and simply read back as comments.
   */
  const MARK_KINDS = { underline: 1, strike: 1, comment: 1 };

  function cleanMark(input) {
    const data = input || {};
    const chapterId = String(data.chapterId || '');
    if (!chapterId) return null;
    const raw = String(data.kind || '');
    const start = Math.max(0, Math.round(Number(data.start) || 0));
    const end = Math.max(start, Math.round(Number(data.end) || 0));
    if (end <= start) return null;
    const note = String(data.note == null ? '' : data.note).slice(0, 400);
    // R53e：文字只属于批注。下划线是「这句好」、删除线是「这句要删」，两者都是
    // 指一下就走；批注是「这里有话」。一条线一旦带了文字，它就已经是批注了，
    // kind 只决定它画成什么样子。把这条不变式钉在写入端，就不会再出现「一条
    // 下划线底下带一条批注」那种两个身份叠在同一句话上的状态——用户说的「重复」
    // 指的就是它。反过来，comment 允许暂时没有文字（刚建出来还没写的那一下）。
    const kind = note.trim()
      ? 'comment'
      : (raw === 'todo' ? 'underline' : (MARK_KINDS[raw] ? raw : 'underline'));
    return {
      chapterId: chapterId,
      novelId: data.novelId ? String(data.novelId) : '',
      kind: kind,
      start: start,
      end: end,
      // The quoted words are stored alongside the offsets so a mark still says
      // something useful after the paragraph around it is rewritten — the
      // offsets drift, the quote does not.
      quote: String(data.quote == null ? '' : data.quote).slice(0, 240),
      note: note,
    };
  }

  async function listMarks(novelId, chapterId) {
    let rows;
    if (chapterId != null && String(chapterId)) {
      rows = await readIndex('marks', 'byChapterId', String(chapterId));
    } else if (novelId != null && String(novelId)) {
      rows = await readIndex('marks', 'byNovelId', String(novelId));
    } else {
      rows = await readAll('marks');
    }
    return (rows || [])
      .filter(function (row) {
        return row && row.id;
      })
      .map(function (row) {
        // R47 rows may carry the retired `todo` kind. Rewrite it on the way out
        // rather than rewriting the database: an older backup restored later
        // must not bring the kind back either.
        if (String(row.kind) === 'todo') {
          return Object.assign({}, row, { kind: 'underline' });
        }
        // R53e: a row written before 文字只属于批注 could be an underline that
        // also carried words. It is a comment — it always was, the kind just
        // did not say so. Normalising on read keeps the old shelf intact and
        // makes the rule true for everything the UI ever sees.
        if (String(row.note || '').trim() && String(row.kind) !== 'comment') {
          return Object.assign({}, row, { kind: 'comment' });
        }
        return row;
      })
      .sort(function (a, b) {
        return (Number(a.start) || 0) - (Number(b.start) || 0) || (Number(a.end) || 0) - (Number(b.end) || 0);
      });
  }

  /**
   * R53: one range of words carries at most one annotation.
   *
   * Re-selecting the same sentence and drawing another line used to insert a
   * second row: the two lines painted on top of each other, and deleting the
   * visible one left the other behind — so the writer had to press 删除 once per
   * accidental duplicate. A range is now the identity of a mark: re-drawing it
   * rewrites the existing row (kind / note) instead of adding a sibling, and
   * deleting it removes every duplicate that an older build left in the store.
   */
  function sameRange(a, b) {
    if (!a || !b) return false;
    if (String(a.chapterId || '') !== String(b.chapterId || '')) return false;
    return (Math.round(Number(a.start) || 0) === Math.round(Number(b.start) || 0))
      && (Math.round(Number(a.end) || 0) === Math.round(Number(b.end) || 0));
  }

  async function sameRangeRows(clean) {
    const rows = await listMarks(null, clean.chapterId);
    return (rows || []).filter(function (row) {
      return sameRange(row, clean);
    });
  }

  async function createMark(input) {
    const clean = cleanMark(input);
    if (!clean) return undefined;
    const stamp = now();
    // R52: honour an id the caller already painted with. The editor draws the
    // line the instant it is asked for and then tells the app to persist it; if
    // the row came back under a different id, the card that was just opened
    // would point at a mark that does not exist and 删除 would do nothing.
    const wanted = input && input.id ? String(input.id) : '';
    const siblings = await sameRangeRows(clean);
    if (siblings.length) {
      // Keep the oldest row as the one the UI has been pointing at; clean up any
      // duplicates an older build wrote for the same range.
      const keep = siblings[0];
      const mergedNote = clean.note ? clean.note : String(keep.note || '');
      const merged = Object.assign({}, keep, {
        // R53e：文字说了算。合并后只要还有字，它就必须是批注——否则会出现
        // 「kind=strike 但身上带 note」的行，刷新之后又变回一条批注，看着像
        // 改了没生效。
        kind: mergedNote.trim() ? 'comment' : clean.kind,
        // An empty note on a re-draw must not wipe a note the writer already
        // wrote — switching an underline to a strike should keep its comment.
        note: mergedNote,
        quote: clean.quote || String(keep.quote || ''),
        novelId: clean.novelId || String(keep.novelId || ''),
        updatedAt: stamp,
      });
      const ops = [{ store: 'marks', type: 'put', value: merged }];
      for (let i = 1; i < siblings.length; i += 1) {
        ops.push({ store: 'marks', type: 'delete', key: siblings[i].id });
      }
      if (wanted && siblings.every(function (row) { return String(row.id) !== wanted; })) {
        // The caller painted with a fresh id; it never reached the store, but
        // drop it anyway so a retry can not resurrect it.
        ops.push({ store: 'marks', type: 'delete', key: wanted });
      }
      const ok = await writeBatch(ops);
      if (!ok) throw new Error('保存标注失败');
      notify();
      return merged;
    }
    const row = Object.assign({ id: wanted || uid('mark'), createdAt: stamp, updatedAt: stamp }, clean);
    const ok = await writeBatch([{ store: 'marks', type: 'put', value: row }]);
    if (!ok) throw new Error('保存标注失败');
    notify();
    return row;
  }

  async function updateMark(id, patch) {
    if (!id || !patch) return undefined;
    const current = await readOne('marks', id);
    if (!current) return undefined;
    const next = Object.assign({}, current);
    if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
      next.note = String(patch.note == null ? '' : patch.note).slice(0, 400);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'kind') && MARK_KINDS[String(patch.kind)]) {
      next.kind = String(patch.kind);
    }
    // R53e：写完这一句它是不是批注，由文字说了算——两个方向都成立。写着字的线
    // 一律是批注（把一条下划线写成批注，就是「批注」这个动作本身）；把批注的文字
    // 清空，它就退回一条下划线（否则会留下一条「没有话的批注」：占着批注的底色，
    // 页边却没有签，是三种状态里最说不清的一种）。显式指定 kind 的重画走 createMark，
    // 不经过这里。
    const patchTouchesNote = Object.prototype.hasOwnProperty.call(patch, 'note');
    const patchSetsKind = Object.prototype.hasOwnProperty.call(patch, 'kind')
      && MARK_KINDS[String(patch.kind)];
    if (String(next.note || '').trim()) next.kind = 'comment';
    else if (patchTouchesNote && !patchSetsKind) next.kind = 'underline';
    next.updatedAt = now();
    const ops = [{ store: 'marks', type: 'put', value: next }];
    // Duplicates an older build left on this range must not keep a stale note:
    // after a refresh the copy without the new note could win the paint.
    const siblings = await sameRangeRows(current);
    for (let i = 0; i < siblings.length; i += 1) {
      const row = siblings[i];
      if (String(row.id) === String(next.id)) continue;
      ops.push({
        store: 'marks',
        type: 'put',
        value: Object.assign({}, row, { kind: next.kind, note: next.note, updatedAt: next.updatedAt }),
      });
    }
    const ok = await writeBatch(ops);
    if (!ok) return undefined;
    notify();
    return next;
  }

  async function deleteMark(id) {
    if (!id) return false;
    const current = await readOne('marks', id);
    if (!current) return false;
    // R53: a range is one annotation, so 删除 clears every duplicate that sits on
    // the same words — one press, no matter how many times it was drawn before.
    const ops = [{ store: 'marks', type: 'delete', key: current.id }];
    const siblings = await sameRangeRows(current);
    for (let i = 0; i < siblings.length; i += 1) {
      if (String(siblings[i].id) === String(current.id)) continue;
      ops.push({ store: 'marks', type: 'delete', key: siblings[i].id });
    }
    const ok = await writeBatch(ops);
    if (!ok) return false;
    notify();
    return true;
  }

  /**
   * Keeps marks pinned to the words they were drawn on across an edit.
   *
   * `diff` is `{head, oldMid, newMid}`: everything before `head` is untouched,
   * the middle was replaced, everything after it moved by `newMid - oldMid`.
   *
   * A mark that lay wholly inside the replaced middle is deleted — the words it
   * pointed at are gone, and leaving it behind would underline whatever happens
   * to occupy those offsets now.
   */
  async function shiftMarksForEdit(chapterId, diff) {
    const id = String(chapterId || '');
    const d = diff || {};
    if (!id) return 0;
    const head = Math.max(0, Number(d.head) || 0);
    const oldMid = Math.max(0, Number(d.oldMid) || 0);
    const newMid = Math.max(0, Number(d.newMid) || 0);
    if (!oldMid && !newMid) return 0;
    const delta = newMid - oldMid;
    const rows = await listMarks(null, id);
    const ops = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const start = Number(row.start) || 0;
      const end = Number(row.end) || 0;
      if (end <= head) continue; // wholly before the edit
      if (start >= head + oldMid) {
        if (delta) {
          ops.push({
            store: 'marks',
            type: 'put',
            value: Object.assign({}, row, { start: start + delta, end: end + delta, updatedAt: now() }),
          });
        }
        continue;
      }
      // Overlaps the replaced middle: keep whatever survived on the edges.
      const nextStart = start <= head ? start : head + newMid;
      const nextEnd = end >= head + oldMid ? end + delta : head + newMid;
      if (nextEnd <= nextStart) {
        ops.push({ store: 'marks', type: 'delete', key: row.id });
      } else {
        ops.push({
          store: 'marks',
          type: 'put',
          value: Object.assign({}, row, { start: nextStart, end: nextEnd, updatedAt: now() }),
        });
      }
    }
    if (!ops.length) return 0;
    await writeBatch(ops);
    notify();
    return ops.length;
  }

  // ---------------------------------------------------------------------------
  // 已接收的修改建议 (R73)
  //
  // The advice column and the selection window both end with a decision: 接受 or
  // 拒绝. Only the accepted half is worth a row — a rejected suggestion has
  // served its purpose the moment the writer says no, and keeping it would turn
  // the store into a log of everything an editor ever said.
  //
  // A row is *not* a replacement: accepting means "this edit is right, I will
  // make it", so the manuscript is never rewritten behind the writer's back.
  // The row records the words it talked about, the rewritten text the model
  // offered, and the advice itself — enough to reopen the case weeks later.
  // ---------------------------------------------------------------------------

  function cleanRevision(input) {
    const data = input || {};
    const chapterId = String(data.chapterId || '');
    if (!chapterId) return null;
    const quote = String(data.quote == null ? '' : data.quote).slice(0, 600);
    if (!quote.trim()) return null;
    const start = Math.max(0, Math.round(Number(data.start) || 0));
    const end = Math.max(start, Math.round(Number(data.end) || 0));
    return {
      chapterId: chapterId,
      novelId: data.novelId ? String(data.novelId) : '',
      start: start,
      end: end,
      quote: quote,
      // 改后的文字. Empty when the model only advised instead of rewriting
      // ("这一段节奏拖着" has no drop-in replacement); the card renders what it has.
      revised: String(data.revised == null ? '' : data.revised).slice(0, 600),
      issue: String(data.issue == null ? '' : data.issue).slice(0, 200),
      why: String(data.why == null ? '' : data.why).slice(0, 200),
      advice: String(data.advice == null ? '' : data.advice).slice(0, 400),
      kind: String(data.kind == null ? '' : data.kind).slice(0, 24),
      severity: String(data.severity == null ? '' : data.severity).slice(0, 12),
      // 'selection' = asked for by selecting words, 'chapter' = the dock's
      // whole-chapter read. Kept because the two read differently in the list.
      source: String(data.source || 'chapter').slice(0, 16),
      createdAt: Number(data.createdAt) || now(),
    };
  }

  async function listRevisions(chapterId) {
    let rows;
    if (chapterId != null && String(chapterId)) {
      rows = await readIndex('revisions', 'byChapterId', String(chapterId));
    } else {
      rows = await readAll('revisions');
    }
    return (rows || [])
      .filter(function (row) {
        return row && row.id;
      })
      .sort(function (a, b) {
        return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
      });
  }

  async function createRevision(input) {
    const clean = cleanRevision(input);
    if (!clean) return undefined;
    const stamp = now();
    const wanted = input && input.id ? String(input.id) : '';
    const row = Object.assign({ id: wanted || uid('rev'), updatedAt: stamp }, clean);
    if (!row.createdAt) row.createdAt = stamp;
    const ok = await writeBatch([{ store: 'revisions', type: 'put', value: row }]);
    if (!ok) throw new Error('保存修改建议失败');
    notify();
    return row;
  }

  async function deleteRevision(id) {
    if (!id) return false;
    const ok = await writeBatch([{ store: 'revisions', type: 'delete', key: String(id) }]);
    if (!ok) return false;
    notify();
    return true;
  }

  /**
   * Keeps accepted suggestions pinned to the words they were accepted on.
   *
   * Same contract as `shiftMarksForEdit`: a row wholly inside the replaced
   * middle is dropped (the sentence it described is gone), a row that merely
   * moved is shifted, and a row that overlaps an edge keeps whatever survived.
   */
  async function shiftRevisionsForEdit(chapterId, diff) {
    const id = String(chapterId || '');
    const d = diff || {};
    if (!id) return 0;
    const head = Math.max(0, Number(d.head) || 0);
    const oldMid = Math.max(0, Number(d.oldMid) || 0);
    const newMid = Math.max(0, Number(d.newMid) || 0);
    if (!oldMid && !newMid) return 0;
    const delta = newMid - oldMid;
    const rows = await listRevisions(id);
    const ops = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const start = Number(row.start) || 0;
      const end = Number(row.end) || 0;
      if (end <= head) continue; // wholly before the edit
      if (start >= head + oldMid) {
        if (delta) {
          ops.push({
            store: 'revisions',
            type: 'put',
            value: Object.assign({}, row, { start: start + delta, end: end + delta, updatedAt: now() }),
          });
        }
        continue;
      }
      const nextStart = start <= head ? start : head + newMid;
      const nextEnd = end >= head + oldMid ? end + delta : head + newMid;
      if (nextEnd <= nextStart) {
        ops.push({ store: 'revisions', type: 'delete', key: row.id });
      } else {
        ops.push({
          store: 'revisions',
          type: 'put',
          value: Object.assign({}, row, { start: nextStart, end: nextEnd, updatedAt: now() }),
        });
      }
    }
    if (!ops.length) return 0;
    await writeBatch(ops);
    notify();
    return ops.length;
  }

  // ---------------------------------------------------------------------------
  // 设定集 (R77)
  //
  // 人物 / 地点 / 道具 / 随手设定，按**书**存：一个角色活在整本书里，不属于某一章。
  // 它是写作时的备忘，不进正文、不进导出，删掉也不影响稿子。
  // ---------------------------------------------------------------------------
  const LORE_KINDS = { character: 1, place: 1, item: 1, note: 1 };

  function cleanLore(input) {
    const data = input || {};
    const novelId = String(data.novelId || '');
    const name = String(data.name == null ? '' : data.name).trim().slice(0, 80);
    if (!novelId || !name) return null;
    const kind = LORE_KINDS[String(data.kind || '')] ? String(data.kind) : 'character';
    return {
      novelId: novelId,
      kind: kind,
      name: name,
      body: String(data.body == null ? '' : data.body).slice(0, 4000),
    };
  }

  async function listLore(novelId) {
    const rows = novelId != null && String(novelId)
      ? await readIndex('lore', 'byNovelId', String(novelId))
      : await readAll('lore');
    return (rows || [])
      .filter(function (row) {
        return row && row.id && row.name;
      })
      .sort(function (a, b) {
        const ka = String(a.kind || '');
        const kb = String(b.kind || '');
        if (ka !== kb) return ka < kb ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
      });
  }

  async function createLore(input) {
    const clean = cleanLore(input);
    if (!clean) return undefined;
    const stamp = now();
    const row = Object.assign({ id: uid('lore'), createdAt: stamp, updatedAt: stamp }, clean);
    const ok = await writeBatch([{ store: 'lore', type: 'put', value: row }]);
    if (!ok) throw new Error('保存设定失败');
    notify();
    return row;
  }

  async function updateLore(id, patch) {
    if (!id) return undefined;
    const current = await readOne('lore', id);
    if (!current) return undefined;
    const merged = cleanLore(Object.assign({}, current, patch || {}));
    if (!merged) return undefined;
    const next = Object.assign({}, current, merged, { updatedAt: now() });
    const ok = await writeBatch([{ store: 'lore', type: 'put', value: next }]);
    if (!ok) throw new Error('保存设定失败');
    notify();
    return next;
  }

  async function deleteLore(id) {
    if (!id) return false;
    const ok = await writeBatch([{ store: 'lore', type: 'delete', key: String(id) }]);
    if (!ok) return false;
    notify();
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers = subscribers.concat([fn]);
    let active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      subscribers = subscribers.filter(function (item) {
        return item !== fn;
      });
    };
  }

  /**
   * Opens the database. Idempotent: repeat calls reuse the same connection.
   * Throws an Error with a user-facing Chinese message when IndexedDB is
   * unavailable (private mode / disabled storage) so the App can show it.
   */
  async function init() {
    try {
      await openDb();
      return true;
    } catch (err) {
      const reason = err && err.message ? err.message : String(err || '未知错误');
      throw new Error('无法初始化本地数据库（IndexedDB）：' + reason + '。请退出隐私模式或允许本站保存数据后重试。');
    }
  }

  async function close() {
    try {
      const db = dbPromise ? await dbPromise : null;
      if (db) db.close();
    } catch (err) {
      /* ignore */
    }
    dbPromise = null;
  }

  /** Full snapshot of every store, as plain JSON-serialisable records. */
  async function dump() {
    const novels = await readAll('novels');
    const chapters = await readAll('chapters');
    const versions = await readAll('versions');
    const trash = await readAll('trash');
    const settingsRow = await readOne('settings', SETTINGS_KEY);
    const settings =
      settingsRow && settingsRow.value && typeof settingsRow.value === 'object'
        ? settingsRow.value
        : await getSettings();
    const notes = await readAll('notes');
    const marks = await readAll('marks');
    // R73: accepted advice travels with the backup — it is part of the writer's
    // thinking about the book, not a transient UI state.
    const revisions = await readAll('revisions');
    const lore = await readAll('lore');
    return {
      novels: novels || [],
      chapters: chapters || [],
      versions: versions || [],
      trash: trash || [],
      settings: settings || {},
      notes: notes || [],
      marks: marks || [],
      revisions: revisions || [],
      lore: lore || [],
    };
  }

  /**
   * Decide what a restore touches.
   *
   * A folder snapshot carries novels / chapters / settings / notes and — since
   * R79 — marks / lore / revisions. It deliberately does *not* carry versions or
   * the trash (they would multiply every autosave), and a backup written by an
   * older release carries even fewer keys.
   *
   * The rule that matters: **a store is cleared only when the snapshot actually
   * carries a well-formed value for it.** A missing or malformed key means "this
   * backup says nothing trustworthy about it", so the store is left alone; an
   * empty array is a deliberate "make this empty" and still clears. Before R79
   * every restore cleared all nine stores, which is how restoring from a folder
   * silently erased annotations, version history, 设定集, accepted suggestions
   * and the trash.
   *
   * Pure — no IndexedDB here, so `scripts/verify-restore.mjs` can exercise it
   * without a browser.
   */
  function planRestore(snapshot, stores, settingsKey) {
    const data = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const plan = [];
    for (let s = 0; s < stores.length; s += 1) {
      const store = stores[s];
      const raw = Object.prototype.hasOwnProperty.call(data, store) ? data[store] : undefined;
      // Only a well-formed value counts as "the backup speaks about this store".
      // A malformed one (`marks: null`, `versions: "x"`) must preserve, not wipe.
      const carried = store === 'settings'
        ? Array.isArray(raw) || (raw != null && typeof raw === 'object')
        : Array.isArray(raw);
      if (!carried) {
        plan.push({ store: store, carried: false, rows: [] });
        continue;
      }
      let rows;
      if (store === 'settings') {
        if (Array.isArray(raw)) rows = raw;
        else rows = [{ key: settingsKey, value: raw }];
      } else {
        rows = raw;
      }
      plan.push({ store: store, carried: true, rows: rows });
    }
    return plan;
  }

  /**
   * Replaces the database with a backup snapshot in ONE transaction.
   *
   * Stores the snapshot does not mention are left untouched (see `planRestore`),
   * so a folder snapshot — which has no `versions` / `trash` — can no longer wipe
   * them. A full JSON backup (`dump()`) carries all nine keys and therefore still
   * behaves as a whole-database replace. A failed transaction rolls everything
   * back, leaving the previous data intact.
   */
  async function replaceAll(snapshot) {
    const data = snapshot || {};
    const plan = planRestore(data, STORES, SETTINGS_KEY);
    const ops = [];
    for (let p = 0; p < plan.length; p += 1) {
      const entry = plan[p];
      if (!entry.carried) continue;
      const store = entry.store;
      const rows = entry.rows;
      ops.push({ store: store, type: 'clear' });
      for (let i = 0; i < rows.length; i += 1) {
        let value = rows[i];
        if (store === 'settings') {
          if (!value || typeof value !== 'object') continue;
          if (!value.key) value = { key: SETTINGS_KEY, value: value };
        }
        if (!value || typeof value !== 'object') continue;
        ops.push({ store: store, type: 'put', value: value });
      }
    }
    if (!ops.length) return;
    const ok = await writeBatch(ops);
    if (!ok) throw new Error('恢复备份失败');
    notify();
  }

  /**
   * R34: apply books that arrived over the LAN sync mirror.
   *
   * Runs in ONE transaction so a phone push can never leave half a book behind.
   * Deliberately *not* `replaceAll`: the merge already decided per book, and
   * replaceAll clears the stores — that would drop settings, notes, versions and
   * the trash for every book the phone does not know about.
   *
   * Rules, mirroring the host's merge contract:
   *   - a tombstone (`deleted: true`) removes the book and its chapters, and
   *     parks them in `trash` so 撤销 still works;
   *   - a live book is stamped with the phone's `updatedAt`, not with `now()`:
   *     keeping the peer's clock is what makes the next merge a no-op instead of
   *     ping-ponging "mine is newer" forever on two devices with skewed clocks;
   *   - chapters are replaced whole (book-level LWW — the product spec says the
   *     newer book wins, not newer chapters).
   */
  async function applyBooks(books) {
    const list = Array.isArray(books) ? books.filter(function (row) { return row && row.id; }) : [];
    if (!list.length) return 0;
    const existingNovels = (await readAll('novels')) || [];
    const existingChapters = (await readAll('chapters')) || [];
    const existingVersions = (await readAll('versions')) || [];
    // R47: annotations are chapter-scoped character offsets, so when the peer
    // removes a chapter they cannot survive. Read once and drop with the text
    // they were pinned to — an annotation on a chapter nobody has is unreachable
    // and would be restored into a hole, exactly like orphaned versions below.
    const existingMarks = (await readAll('marks')) || [];
    const byNovel = new Map();
    const localById = new Map();
    for (let i = 0; i < existingChapters.length; i += 1) {
      const row = existingChapters[i];
      if (!row || row.id == null) continue;
      localById.set(String(row.id), row);
      if (row.novelId == null) continue;
      const key = String(row.novelId);
      if (!byNovel.has(key)) byNovel.set(key, []);
      byNovel.get(key).push(row);
    }
    // The phone has no idea a chapter can sit inside a 卷, and normalizeBook()
    // on the host only carries {id,title,content,order}. Keep the local parent
    // when the incoming row is silent, otherwise one sync flattened the tree.
    const versionsByChapter = new Map();
    for (let i = 0; i < existingVersions.length; i += 1) {
      const row = existingVersions[i];
      if (!row || row.chapterId == null) continue;
      const key = String(row.chapterId);
      if (!versionsByChapter.has(key)) versionsByChapter.set(key, []);
      versionsByChapter.get(key).push(row);
    }
    const marksByChapter = new Map();
    for (let i = 0; i < existingMarks.length; i += 1) {
      const row = existingMarks[i];
      if (!row || !row.id || row.chapterId == null) continue;
      const key = String(row.chapterId);
      if (!marksByChapter.has(key)) marksByChapter.set(key, []);
      marksByChapter.get(key).push(row);
    }
    // Annotations of one chapter, as delete ops — shared by the two places a
    // chapter can disappear (a tombstone for the whole book, or a chapter the
    // peer no longer has).
    const markOpsOf = function (chapterId) {
      const rows = marksByChapter.get(String(chapterId)) || [];
      const out = [];
      for (let i = 0; i < rows.length; i += 1) out.push({ store: 'marks', type: 'delete', key: rows[i].id });
      return out;
    };

    const ops = [];
    let touched = 0;
    for (let i = 0; i < list.length; i += 1) {
      const incoming = list[i];
      const id = String(incoming.id);
      const existing = existingNovels.find(function (row) { return row && String(row.id) === id; }) || null;
      const currentChapters = byNovel.get(id) || [];
      const stamp = Number(incoming.updatedAt) || now();

      if (incoming.deleted === true) {
        if (!existing) continue;
        const doomedMarks = [];
        for (let c = 0; c < currentChapters.length; c += 1) {
          const rows = marksByChapter.get(String(currentChapters[c].id)) || [];
          for (let mi = 0; mi < rows.length; mi += 1) doomedMarks.push(rows[mi]);
        }
        ops.push({
          store: 'trash',
          type: 'put',
          value: {
            id: uid('trash'),
            kind: 'novel',
            title: existing.title || '未命名小说',
            deletedAt: now(),
            payload: { novel: existing, chapters: currentChapters, versions: [], marks: doomedMarks },
          },
        });
        ops.push({ store: 'novels', type: 'delete', key: id });
        for (let c = 0; c < currentChapters.length; c += 1) {
          ops.push({ store: 'chapters', type: 'delete', key: currentChapters[c].id });
          const mops = markOpsOf(currentChapters[c].id);
          for (let mo = 0; mo < mops.length; mo += 1) ops.push(mops[mo]);
        }
        touched += 1;
        continue;
      }

      const novelRow = {
        id: id,
        title: String(incoming.title || '') || (existing && existing.title) || '未命名小说',
        author: String(incoming.author || '') || (existing && existing.author) || '',
        description: (existing && existing.description) || '',
        cover: (existing && existing.cover) || null,
        createdAt: Number(existing && existing.createdAt) || stamp,
        updatedAt: stamp,
      };
      ops.push({ store: 'novels', type: 'put', value: novelRow });

      const incomingChapters = Array.isArray(incoming.chapters) ? incoming.chapters : [];
      const keep = {};
      for (let c = 0; c < incomingChapters.length; c += 1) {
        const row = incomingChapters[c];
        if (!row || !row.id) continue;
        keep[String(row.id)] = true;
        const body = String(row.content == null ? '' : row.content);
        // R36: a peer sends plaintext, but this device may have 正文加密 on. Sealing
        // here keeps a synced chapter from becoming the one plaintext row in an
        // otherwise encrypted store; the word count stays measured on plaintext.
        const sealedBody = await sealContent(body);
        const localRow = localById.get(String(row.id)) || null;
        ops.push({
          store: 'chapters',
          type: 'put',
          value: {
            id: String(row.id),
            novelId: id,
            parentId: row.parentId != null ? String(row.parentId) : (localRow ? localRow.parentId : null) || null,
            title: String(row.title || ''),
            content: sealedBody,
            order: Number(row.order) || 0,
            wordCount: countWords(body),
            // Both peers stamp createdAt on first sight; without the local value a
            // chapter synced twice dates itself to the second sync.
            createdAt: Number(row.createdAt) || Number(localRow && localRow.createdAt) || stamp,
            updatedAt: stamp,
            enc: null,
          },
        });
      }
      // Chapters the phone does not have were deleted there; drop them locally
      // too, otherwise the next push would send them straight back.
      for (let c = 0; c < currentChapters.length; c += 1) {
        const row = currentChapters[c];
        if (!row || keep[String(row.id)]) continue;
        ops.push({ store: 'chapters', type: 'delete', key: row.id });
        // Version history of a chapter nobody has is unreachable from the UI and
        // would be restored into a hole by 回收站; drop it with the chapter.
        const orphans = versionsByChapter.get(String(row.id)) || [];
        for (let v = 0; v < orphans.length; v += 1) {
          ops.push({ store: 'versions', type: 'delete', key: orphans[v].id });
        }
        // R47: same reasoning for annotations — the offsets they point at are
        // gone, so the marks under them are not worth keeping.
        const orphanMarks = markOpsOf(row.id);
        for (let mo = 0; mo < orphanMarks.length; mo += 1) ops.push(orphanMarks[mo]);
      }
      touched += 1;
    }

    if (!ops.length) return 0;
    const ok = await writeBatch(ops);
    if (!ok) throw new Error('应用同步数据失败');
    notify();
    return touched;
  }

  NW.db = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES.slice(),
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    applyBooks: applyBooks,
    init: init,
    close: close,
    subscribe: subscribe,
    listNovels: listNovels,
    getNovel: getNovel,
    createNovel: createNovel,
    updateNovel: updateNovel,
    deleteNovel: deleteNovel,
    listChapters: listChapters,
    listAllChapters: listAllChapters,
    getChapter: getChapter,
    createChapter: createChapter,
    createChapters: createChapters,
    updateChapter: updateChapter,
    deleteChapter: deleteChapter,
    saveChapterContent: saveChapterContent,
    moveChapter: moveChapter,
    saveVersion: saveVersion,
    listVersions: listVersions,
    getVersion: getVersion,
    listTrash: listTrash,
    restoreTrash: restoreTrash,
    emptyTrash: emptyTrash,
    getSettings: getSettings,
    hasSettings: hasSettings,
    saveSettings: saveSettings,
    listNotes: listNotes,
    saveChapterNote: saveChapterNote,
    createNote: createNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    listMarks: listMarks,
    createMark: createMark,
    updateMark: updateMark,
    deleteMark: deleteMark,
    shiftMarksForEdit: shiftMarksForEdit,
    listRevisions: listRevisions,
    createRevision: createRevision,
    deleteRevision: deleteRevision,
    shiftRevisionsForEdit: shiftRevisionsForEdit,
    listLore: listLore,
    createLore: createLore,
    updateLore: updateLore,
    deleteLore: deleteLore,
    dump: dump,
    replaceAll: replaceAll,
    /** Exposed for `scripts/verify-restore.mjs`: pure, no IndexedDB involved. */
    planRestore: planRestore,
    encryptAll: encryptAll,
    decryptAll: decryptAll,
  };
})();
