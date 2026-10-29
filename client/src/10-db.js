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
  const DB_VERSION = 3;
  const STORES = ['novels', 'chapters', 'versions', 'trash', 'settings', 'notes', 'marks'];
  const VERSION_LIMIT = 50;
  const SETTINGS_KEY = 'app';
  const ENC_PREFIX = 'enc:v1:';

  const DEFAULT_SETTINGS = {
    fontFamily: '"Noto Serif SC","Source Han Serif SC","Songti SC",serif',
    fontSize: 20,
    lineHeight: 2,
    pageWidth: 760,
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
     * R46: immersive mode can fade every line except the one being written.
     * `focusDim` is the switch, `focusLines` how many lines either side stay
     * clear. On by default because a writer who goes immersive has already said
     * "give me the page and nothing else"; the setting is the way out.
     */
    focusDim: true,
    focusLines: 2,
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

  async function updateChapter(id, patch) {
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
    await writeBatch(ops);
    if (root.novelId) await touchNovel(root.novelId);
    notify();
    // R22: hand the trash id back so the UI can offer 撤销 on the toast. The
    // row already sits in 回收站, but nobody wants to open a dialog to undo a
    // mis-click.
    return trashItem.id;
  }

  async function saveChapterContent(id, content) {
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
    if (!ok) return;
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
   */
  const MARK_KINDS = { underline: 1, strike: 1, comment: 1 };

  function cleanMark(input) {
    const data = input || {};
    const chapterId = String(data.chapterId || '');
    if (!chapterId) return null;
    const raw = String(data.kind || '');
    const kind = raw === 'todo' ? 'underline' : (MARK_KINDS[raw] ? raw : 'underline');
    const start = Math.max(0, Math.round(Number(data.start) || 0));
    const end = Math.max(start, Math.round(Number(data.end) || 0));
    if (end <= start) return null;
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
      note: String(data.note == null ? '' : data.note).slice(0, 400),
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
        return row;
      })
      .sort(function (a, b) {
        return (Number(a.start) || 0) - (Number(b.start) || 0) || (Number(a.end) || 0) - (Number(b.end) || 0);
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
    next.updatedAt = now();
    const ok = await writeBatch([{ store: 'marks', type: 'put', value: next }]);
    if (!ok) return undefined;
    notify();
    return next;
  }

  async function deleteMark(id) {
    if (!id) return false;
    const ok = await writeBatch([{ store: 'marks', type: 'delete', key: id }]);
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

  // --------------------------------- public ----------------------------------

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
    return {
      novels: novels || [],
      chapters: chapters || [],
      versions: versions || [],
      trash: trash || [],
      settings: settings || {},
      notes: notes || [],
      marks: marks || [],
    };
  }

  /**
   * Replaces the whole database with a backup snapshot in ONE transaction
   * ({novels, chapters, versions, trash?, settings}) — a failure rolls back
   * everything, leaving the previous data intact.
   */
  async function replaceAll(snapshot) {
    const data = snapshot || {};
    const ops = [];
    for (let s = 0; s < STORES.length; s += 1) {
      const store = STORES[s];
      ops.push({ store: store, type: 'clear' });
      let rows;
      if (store === 'settings') {
        const raw = data.settings;
        if (Array.isArray(raw)) rows = raw;
        else if (raw && typeof raw === 'object') rows = [{ key: SETTINGS_KEY, value: raw }];
        else rows = [];
      } else {
        rows = Array.isArray(data[store]) ? data[store] : [];
      }
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
    dump: dump,
    replaceAll: replaceAll,
    encryptAll: encryptAll,
    decryptAll: decryptAll,
  };
})();
