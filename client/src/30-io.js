;(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // NW.api / NW.apiUrl — client → host transport (CONTRACT §3).
  // NW.io / NW.ai — thin wrappers over the host routes plus local file plumbing
  // (pick, download, backup JSON, library mirror/restore).
  // ---------------------------------------------------------------------------

  const API_PREFIX = 'novel-writer/api/';

  // -------------------------------- transport --------------------------------

  /** Mirrors the host's `document.baseURI`-relative routing so sub-path mounts work. */
  function apiUrl(path) {
    const rel = API_PREFIX + String(path == null ? '' : path).replace(/^\/+/, '');
    try {
      const base =
        typeof document !== 'undefined' && document && document.baseURI
          ? document.baseURI
          : typeof location !== 'undefined' && location
            ? location.href
            : 'http://localhost/';
      const url = new URL(rel, base);
      return url.pathname + (url.search || '');
    } catch (err) {
      return '/' + rel;
    }
  }

  function parseReply(body) {
    if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'ok')) {
      if (body.ok) return body.data;
      const error = body.error || {};
      const message = error.message || error.code || '请求失败';
      const err = new Error(String(message));
      err.code = error.code || 'error';
      throw err;
    }
    return body;
  }

  function api(method, payload) {
    const name = String(method == null ? '' : method).trim();
    if (!name) return Promise.reject(new Error('缺少接口方法名'));
    const url = apiUrl(name);
    let response;
    try {
      response = fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
        credentials: 'same-origin',
      });
    } catch (err) {
      return Promise.reject(new Error('网络请求失败：' + (err && err.message ? err.message : String(err))));
    }
    return Promise.resolve(response)
      .then((res) => {
        if (!res || !res.ok) throw new Error('接口不可用：HTTP ' + (res ? res.status : '?'));
        return res.text();
      })
      .then((text) => {
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (err) {
          throw new Error('接口返回格式错误');
        }
        return parseReply(parsed);
      })
      .catch((err) => {
        throw err instanceof Error ? err : new Error('请求失败');
      });
  }

  /** GET ping — used for a cheap connectivity probe. */
  function ping() {
    const url = apiUrl('ping');
    let request;
    try {
      request = fetch(url, { method: 'GET', credentials: 'same-origin' });
    } catch (err) {
      return Promise.reject(new Error('网络请求失败'));
    }
    return Promise.resolve(request)
      .then((res) => (res && res.ok ? res.text() : ''))
      .then((text) => (text ? parseReply(JSON.parse(text)) : null))
      .catch(() => null);
  }

  // --------------------------------- helpers ---------------------------------

  function toBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < arr.length; i += step) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, Math.min(arr.length, i + step)));
    }
    return btoa(bin);
  }

  function fromBase64(text) {
    const bin = atob(String(text || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('没有选中文件'));
        return;
      }
      if (typeof file.text === 'function') {
        Promise.resolve(file.text()).then(resolve, reject);
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsText(file, 'utf-8');
      } catch (err) {
        reject(err instanceof Error ? err : new Error('读取文件失败'));
      }
    });
  }

  function readFileBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('没有选中文件'));
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('读取文件失败'));
      }
    });
  }

  function extensionOf(name) {
    const text = String(name || '');
    const dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1).toLowerCase() : '';
  }

  // ---------------------------------- files ----------------------------------

  function pickFiles(accept) {
    return new Promise((resolve, reject) => {
      let input = null;
      try {
        input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        if (accept) input.accept = String(accept);
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.opacity = '0';
        const cleanup = () => {
          try {
            if (input && input.parentNode) input.parentNode.removeChild(input);
          } catch (err) {
            /* ignore */
          }
        };
        input.onchange = () => {
          const files = [];
          try {
            const list = input.files || [];
            for (let i = 0; i < list.length; i += 1) files.push(list[i]);
          } catch (err) {
            /* ignore */
          }
          cleanup();
          resolve(files);
        };
        input.oncancel = () => {
          cleanup();
          resolve([]);
        };
        // Append (hidden) inside our own root so the picker inherits the document.
        const host =
          (typeof document !== 'undefined' && document.body) ||
          null;
        if (host) host.appendChild(input);
        input.click();
      } catch (err) {
        try {
          if (input && input.parentNode) input.parentNode.removeChild(input);
        } catch (e) {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error('无法打开文件选择器'));
      }
    });
  }

  /** txt/md are split locally; docx/epub go through the host parser. */
  async function importFile(file) {
    if (!file) throw new Error('没有选中文件');
    const name = String(file.name || 'import.txt');
    const ext = extensionOf(name);
    const stem = name.replace(/\.[^.]+$/, '');

    if (ext === 'docx' || ext === 'epub' || ext === 'pdf') {
      const base64 = await readFileBase64(file);
      const data = await api('import.parse', { name: name, base64: base64 });
      const parsed = data || {};
      const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
      return {
        title: String(parsed.title || stem || '导入的书'),
        author: String(parsed.author || ''),
        chapters: chapters.length
          ? chapters.map(function (row, index) {
              return {
                title: String((row && row.title) || '第' + (index + 1) + '章'),
                content: String((row && row.content) || ''),
              };
            })
          : [{ title: stem || '正文', content: '' }],
      };
    }

    const text = await readFileText(file);
    const isMarkdown = ext === 'md' || ext === 'markdown';
    const plain = isMarkdown && NW.format && NW.format.markdownToPlain
      ? NW.format.markdownToPlain(text)
      : text;
    const chapters =
      NW.format && NW.format.autoChapterSplit
        ? NW.format.autoChapterSplit(plain, stem)
        : [{ title: stem || '正文', content: plain }];
    let author = '';
    const authorMatch = /(?:作者|author)\s*[:：]\s*(.{1,40})/i.exec(text.slice(0, 2000));
    if (authorMatch) author = authorMatch[1].trim();
    return {
      title: stem || '导入的书',
      author: author,
      chapters: chapters,
    };
  }

  function download(name, blob) {
    try {
      const filename = String(name || 'download.bin');
      const body = blob instanceof Blob ? blob : new Blob([blob == null ? '' : blob]);
      const url = URL.createObjectURL(body);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      const host = document.body || null;
      if (host) host.appendChild(anchor);
      anchor.click();
      const cleanup = () => {
        try {
          if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
        } catch (err) {
          /* ignore */
        }
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
        }, 4000);
      };
      setTimeout(cleanup, 0);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function exportProject(novel, format, options) {
    const book = novel || {};
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    const payload = {
      format: format || 'docx',
      novel: {
        title: String(book.title || '未命名小说'),
        author: String(book.author || ''),
        chapters: chapters.map(function (row) {
          return {
            title: String((row && row.title) || ''),
            content: String((row && row.content) || ''),
          };
        }),
      },
      options: options || {},
    };
    const built = await api('export.build', payload);
    const data = built || {};
    const base64 = String(data.base64 || '');
    if (!base64) throw new Error('导出失败：没有拿到文件数据');
    const bytes = fromBase64(base64);
    const blob = new Blob([bytes], { type: String(data.mime || 'application/octet-stream') });
    download(String(data.filename || book.title || 'novel'), blob);
    return { filename: data.filename, mime: data.mime, size: bytes.length };
  }

  /**
   * R35 ②: 一键导出所有书籍 — every book into one zip.
   *
   * Deliberately a single host call: exporting N books in the browser would
   * trigger N downloads (Chrome blocks the second one without a prompt) and N
   * round trips carrying N copies of the library. The host builds every document
   * and zips them, so the writer gets one file and one click.
   *
   * A book that cannot be built (e.g. PDF engine down) does not abort the rest;
   * the host reports it in `failed` and the caller decides what to say.
   */
  async function exportAll(novels, format, options) {
    const list = Array.isArray(novels) ? novels.filter(Boolean) : [];
    if (list.length === 0) throw new Error('没有可导出的作品');
    const payload = {
      format: format || 'docx',
      novels: list.map(function (book) {
        return {
          title: String(book.title || '未命名小说'),
          author: String(book.author || ''),
          chapters: (Array.isArray(book.chapters) ? book.chapters : []).map(function (row) {
            return {
              title: String((row && row.title) || ''),
              content: String((row && row.content) || ''),
            };
          }),
        };
      }),
      options: options || {},
    };
    const built = (await api('export.all', payload)) || {};
    const base64 = String(built.base64 || '');
    if (!base64) throw new Error('导出失败：没有拿到压缩包数据');
    const bytes = fromBase64(base64);
    const blob = new Blob([bytes], { type: String(built.mime || 'application/zip') });
    download(String(built.filename || 'novel-writer.zip'), blob);
    return {
      filename: built.filename,
      size: bytes.length,
      count: Number(built.count) || list.length,
      failed: Array.isArray(built.failed) ? built.failed : [],
    };
  }

  // --------------------------------- backups ---------------------------------

  function backupStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  async function exportBackupJson() {
    const snapshot = NW.db && typeof NW.db.dump === 'function'
      ? await NW.db.dump()
      : { novels: [], chapters: [], versions: [], trash: [], settings: {} };
    const body = {
      app: 'novel-writer',
      version: (NW && NW.version) || '1.0.0',
      schema: 1,
      exportedAt: new Date().toISOString(),
      data: snapshot,
    };
    return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
  }

  async function importBackupJson(blob) {
    if (!blob) throw new Error('没有选择备份文件');
    let text = '';
    if (typeof blob === 'string') text = blob;
    else if (typeof blob.text === 'function') text = await blob.text();
    else text = await readFileText(blob);
    let parsed = null;
    try {
      parsed = JSON.parse(String(text || '').trim());
    } catch (err) {
      throw new Error('备份文件不是有效的 JSON');
    }
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || typeof data !== 'object') throw new Error('备份文件内容为空');
    if (!NW.db || typeof NW.db.replaceAll !== 'function') throw new Error('数据库不可用');
    await NW.db.replaceAll(data);
    return {
      novels: Array.isArray(data.novels) ? data.novels.length : 0,
      chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
    };
  }

  function saveBackup(snapshot) {
    // Convenience used by the backup dialog: snapshot → JSON blob download.
    const body = {
      app: 'novel-writer',
      version: (NW && NW.version) || '1.0.0',
      schema: 1,
      exportedAt: new Date().toISOString(),
      data: snapshot,
    };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    download('novel-writer-backup-' + backupStamp() + '.json', blob);
    return blob;
  }

  // ----------------------------------- AI ------------------------------------

  function models() {
    return api('models', {});
  }

  function proofread(input) {
    const data = input || {};
    const payload = {
      provider: data.provider,
      model: data.model,
      text: String(data.text == null ? '' : data.text),
      mode: data.mode || 'typo',
    };
    // R29: only send the writer's brief when there is one — the host already
    // knows the shipped default and must not be handed an empty override.
    if (data.rules) payload.rules = String(data.rules);
    return api('proofread', payload);
  }

  /**
   * R34: ask the writer to pick a model, then try that one.
   *
   * Returns `{provider, model}` or null. `NW.askModel` is installed by the app
   * shell (it needs a dialog host); when nothing is installed we simply give up
   * and let the original error surface.
   */
  async function askModelForRetry(input) {
    if (typeof NW.askModel !== 'function') return null;
    const picked = await NW.askModel(input);
    if (!picked || !picked.provider || !picked.model) return null;
    return { provider: String(picked.provider), model: String(picked.model) };
  }

  /**
   * `proofread` with automatic model failover.
   *
   * The happy path costs exactly one extra request (the model list); that list
   * is already cached by the Settings dialog in the same tick, so the practical
   * cost of "always have a fallback" is one fetch per action.
   */
  async function proofreadSafe(input) {
    const body = input || {};
    let list = null;
    try {
      list = await models();
    } catch (err) {
      list = null;
    }
    const preferred = { provider: body.provider, model: body.model };
    const call = (candidate) => proofread(Object.assign({}, body, { provider: candidate.provider, model: candidate.model }));
    const result = await withModelFallback(list, preferred, call, {
      emptyMessage: NW.t('还没有配置可用的模型，请先在 Harness 里登录一个模型提供方。'),
      onRetry: body.onRetry,
    });
    if (result.ok) return Object.assign({}, result.data, { usedModel: result.used, failovers: result.tried });
    // Everything failed: offer the picker once. A writer who chose the wrong
    // model on purpose should not have to go to Settings and come back.
    const picked = await askModelForRetry({
      kind: 'proofread',
      label: 'AI 校对',
      tried: result.tried,
      models: list,
      preferred: preferred,
    });
    if (picked) {
      const second = await call(picked);
      return Object.assign({}, second, { usedModel: picked, failovers: result.tried });
    }
    const err = result.error || new Error(NW.t('模型调用失败'));
    err.tried = result.tried;
    throw err;
  }

  /** `revise` with automatic model failover (same contract as `proofreadSafe`). */
  async function reviseSafe(input) {
    const body = input || {};
    let list = null;
    try {
      list = await models();
    } catch (err) {
      list = null;
    }
    const preferred = { provider: body.provider, model: body.model };
    const call = (candidate) => revise(Object.assign({}, body, { provider: candidate.provider, model: candidate.model }));
    const result = await withModelFallback(list, preferred, call, {
      emptyMessage: NW.t('还没有配置可用的模型，请先在 Harness 里登录一个模型提供方。'),
      onRetry: body.onRetry,
    });
    if (result.ok) return Object.assign({}, result.data, { usedModel: result.used, failovers: result.tried });
    const picked = await askModelForRetry({
      kind: 'revise',
      label: '修改建议',
      tried: result.tried,
      models: list,
      preferred: preferred,
    });
    if (picked) {
      const second = await call(picked);
      return Object.assign({}, second, { usedModel: picked, failovers: result.tried });
    }
    const err = result.error || new Error(NW.t('模型调用失败'));
    err.tried = result.tried;
    throw err;
  }

  function selftest() {
    return api('selftest', {});
  }

  // ------------------------------ model fallback -----------------------------
  //
  // R34: "if the AI model cannot be reached, does it offer to pick another one?"
  // It did not — a dead provider just surfaced 「模型调用失败」 and stopped. The
  // two helpers below let every AI surface retry across the other configured
  // models before giving up.
  //
  // They live here rather than in each dialog because there are four callers
  // (proofread, typeset advice, submit.prepare, revise) and the ordering rule is
  // identical: the model the writer chose first, then the harness default, then
  // anything else the host knows about.

  /**
   * Collect `{provider, model, label}` candidates, best first.
   *
   * `preferred` is the writer's own choice from Settings; it leads the list even
   * when discovery does not list it (some providers expose no model list, and a
   * hand-typed pair is still a legitimate target).
   */
  function modelCandidates(list, preferred) {
    const out = [];
    const seen = new Set();
    const push = (provider, model, label) => {
      const pv = String(provider == null ? '' : provider).trim();
      const mv = String(model == null ? '' : model).trim();
      if (!pv || !mv) return;
      const key = pv + '\u0000' + mv;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ provider: pv, model: mv, label: label || mv + ' · ' + pv });
    };
    const pref = preferred || {};
    const defaultTarget = (list && list.current) || {};
    // 1. the writer's pick, 2. the harness default, 3. everything discovered.
    push(pref.provider, pref.model, pref.label);
    push(defaultTarget.provider, defaultTarget.model, (defaultTarget.model || '') + ' · ' + (defaultTarget.provider || '') + NW.t('（当前默认）'));
    for (const row of (list && list.models) || []) {
      if (row) push(row.provider, row.id, (row.name || row.id) + ' · ' + row.provider);
    }
    return out;
  }

  /**
   * Run `call(candidate)` until one succeeds.
   *
   * Returns `{ok:true, data, used, tried}` or `{ok:false, error, tried}` where
   * `tried` is the list of `{label, message}` failures — the caller shows them
   * so "it did not work" becomes "these three did not work, and why".
   *
   * `onRetry(candidate, error, index)` is called before each second-and-later
   * attempt so a UI can say 「正在改用 X 重试…」 instead of looking frozen.
   */
  async function withModelFallback(list, preferred, call, options) {
    const opts = options || {};
    const candidates = modelCandidates(list, preferred);
    if (!candidates.length) {
      return { ok: false, error: new Error(opts.emptyMessage || '没有可用的模型'), tried: [], used: null };
    }
    const tried = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (index > 0 && typeof opts.onRetry === 'function') {
        try {
          opts.onRetry(candidate, tried[tried.length - 1] || null, index);
        } catch (err) {
          /* a UI callback must never break the retry loop */
        }
      }
      try {
        const data = await call(candidate);
        return { ok: true, data: data, used: candidate, tried: tried };
      } catch (err) {
        // An abort is the writer's own doing; retrying would fight them.
        if (err && err.code === 'aborted') return { ok: false, error: err, tried: tried, used: null };
        tried.push({ label: candidate.label, message: String((err && err.message) || err || '失败'), code: String((err && err.code) || '') });
      }
    }
    return { ok: false, error: new Error(tried.length ? tried[tried.length - 1].message : NW.t('模型调用失败')), tried: tried, used: null };
  }

  // --------------------------------- library ---------------------------------

  /** Reads the host-side library configuration ({dir, mirror, ...}). */
  function libraryGet() {
    return api('library.get', {});
  }

  /**
   * Persists the library configuration. Only the fields the dialog actually
   * owns are sent so a stale caller cannot clobber unrelated host settings.
   */
  function librarySet(patch) {
    const input = patch && typeof patch === 'object' ? patch : {};
    return api('library.set', {
      dir: input.dir == null ? '' : String(input.dir),
      mirror: input.mirror === true,
      encrypt: input.encrypt === true,
    });
  }

  /**
   * Writes the library snapshot to disk. Chapters and settings ride along so the
   * encrypted file alone can restore everything (not just the book list).
   */
  function libraryMirror(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    return api('library.mirror', {
      novels: Array.isArray(input.novels) ? input.novels : [],
      chapters: Array.isArray(input.chapters) ? input.chapters : [],
      settings: input.settings && typeof input.settings === 'object' ? input.settings : null,
      encrypt: input.encrypt === true,
    });
  }

  /** Opens the native folder picker on the host; resolves `{dir}`. */
  function libraryPick() {
    return api('library.pick', {});
  }

  /**
   * Reads back an encrypted snapshot; resolves `{dir, name, encrypted, snapshot}`.
   * Pass `{path}` / `{dir}` for a folder the host can open itself, or
   * `{text, name}` for a file the browser picker handed us (the page never sees
   * a real path, so the bytes travel to the host and it decrypts them there).
   */
  function libraryRestore(target) {
    const input = target && typeof target === 'object' ? target : {};
    return api('library.restore', {
      dir: input.dir == null ? '' : String(input.dir),
      path: input.path == null ? '' : String(input.path),
      text: input.text == null ? '' : String(input.text),
      name: input.name == null ? '' : String(input.name),
    });
  }

  /** Lists the book files the host already wrote into the library directory. */
  function libraryList() {
    return api('library.list', {});
  }

  /** Decrypts .nwe mirror files (.docx / .json) back into plain files under outDir. */
  function libraryDecryptTo(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    return api('library.decryptTo', {
      dir: input.dir == null ? '' : String(input.dir),
      outDir: input.outDir == null ? '' : String(input.outDir),
    });
  }

  // --------------------------------- journals --------------------------------

  /** Built-in literary journals merged with the user's own overrides. */
  function journalsList() {
    return api('journals.list', {});
  }

  /** Persists user edits (email / requirements / notes) for journals. */
  function journalsSave(entries) {
    return api('journals.save', { entries: Array.isArray(entries) ? entries : [] });
  }

  /**
   * R11 ⑦: delete one journal.
   *
   * Deleting is its own call because a shipped journal needs a tombstone — a
   * plain "save without this row" would be undone by the next read, which
   * rebuilds the list from the built-in table.
   * → `{deleted, journals}`
   */
  function journalsRemove(id) {
    return api('journals.remove', { id: String(id == null ? '' : id) });
  }

  /** R11 ⑦: id for a journal the user is about to create (`name` → `slug`). */
  function journalsNewId(name, existingIds) {
    const taken = {};
    (Array.isArray(existingIds) ? existingIds : []).forEach((value) => {
      taken[String(value == null ? '' : value).trim().toLowerCase()] = true;
    });
    const base =
      String(name == null ? '' : name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'custom-journal';
    if (!taken[base]) return base;
    let index = 2;
    while (taken[base + '-' + index]) index += 1;
    return base + '-' + index;
  }

  /**
   * Which inbox a given manuscript should be sent to.
   *
   * A journal may publish short stories to one address and serialised novels to
   * another, so the answer depends on genre + word count. Resolving on the host
   * keeps this identical to what `submit.prepare` uses.
   * → `{journal, resolved:{email,note,band,bandLabel,matched,variants}}`
   */
  function journalsEmail(journalId, options) {
    const input = options && typeof options === 'object' ? options : {};
    return api('journals.email', {
      journalId: String(journalId || ''),
      genre: String(input.genre || ''),
      wordCount: Number(input.wordCount) || 0,
    });
  }

  /**
   * Bulk-paste inboxes onto existing journals. Lines are
   * `期刊名 | 邮箱 [| 体裁] [| 字数] [| 备注]`; rows with 体裁/字数 become
   * per-genre / per-length variants. → `{updated, added, unmatched, skipped, journals}`
   */
  function journalsImportEmails(text, dryRun) {
    return api('journals.importEmails', {
      text: String(text || ''),
      dryRun: dryRun === true,
    });
  }

  /**
   * Journal matching for one manuscript.
   *
   * `work` = `{wordCount, genre, tags:[…], title}`; `extra` may carry
   * `{excerpt, provider, model, limit}`. When an excerpt is supplied the Host
   * lets the model read it and judge fit + quality; otherwise (or if the model
   * is down) it answers from the rule ranker and says so via `by:'rules'`.
   * Resolves `{recommendations:[{journal,score,reasons,match?,rules?}], by, note?}`.
   */
  function journalsRecommend(work, limit, extra) {
    const input = work && typeof work === 'object' ? work : {};
    const opts = extra && typeof extra === 'object' ? extra : {};
    const body = {
      work: {
        wordCount: Number(input.wordCount) || 0,
        genre: String(input.genre || ''),
        tags: Array.isArray(input.tags) ? input.tags : [],
        title: String(input.title || ''),
      },
      limit: Number(limit) || 8,
    };
    if (opts.excerpt) body.excerpt = String(opts.excerpt);
    if (opts.provider) body.provider = String(opts.provider);
    if (opts.model) body.model = String(opts.model);
    return api('journals.recommend', body);
  }

  // ---------------------------------- submit ---------------------------------

  /** Builds the submission email + a format-adjusted manuscript. */
  function submitPrepare(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    return api('submit.prepare', {
      journal: input.journal || null,
      genre: String(input.genre || ''),
      work: input.work || { title: '', author: '', chapters: [] },
      profile: input.profile || {},
    });
  }

  /**
   * Sends the previewed submission through the configured SMTP account.
   * `title` / `genre` / `wordCount` are persisted with the record so the
   * 投稿管理 dialog can list a submission after the novel is renamed.
   *
   * `novelId` must travel with them: the title above is a snapshot of what was
   * mailed, and the only way the log can later say 「现名（投稿时：旧名）」 is by
   * following the book by id. Dropping it here (this object is a whitelist, so
   * anything unlisted is silently discarded) is exactly what made a renamed
   * book keep showing its old name even though the wizard did send the id.
   */
  function submitSend(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    return api('submit.send', {
      to: String(input.to || ''),
      subject: String(input.subject || ''),
      body: String(input.body || ''),
      attachments: Array.isArray(input.attachments) ? input.attachments : [],
      journalId: String(input.journalId || ''),
      novelId: String(input.novelId || ''),
      title: String(input.title || ''),
      genre: String(input.genre || ''),
      wordCount: Number(input.wordCount) || 0,
    });
  }

  /**
   * Inbox rows carry an RFC 2822 `date` string, not a timestamp — `Number()`
   * would give NaN and every reply would look like it predates the submission.
   */
  function mailTime(row) {
    const stamp = Number(row && (row.at || row.time));
    if (Number.isFinite(stamp) && stamp > 0) return stamp;
    const text = String((row && row.date) || '');
    if (!text) return 0;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Recent submission records (newest first, capped by the host).
   *
   * `options.replies` is the inbox slice to reconcile against — the host derives
   * 「等待回复」/「已超期」 from it (R34). Omitting it keeps the stored statuses, so
   * a refresh that cannot reach IMAP never invents a status.
   */
  function submitRecord(options) {
    const input = options && typeof options === 'object' ? options : {};
    const payload = {};
    if (Array.isArray(input.replies)) {
      payload.replies = input.replies.map((row) => ({
        uid: Number(row && row.uid) || 0,
        from: String((row && (row.from || row.address)) || ''),
        subject: String((row && row.subject) || ''),
        at: mailTime(row),
      }));
    }
    return api('submit.record', payload);
  }

  /** Updates one submission's status (accepted / rejected / …) or note. */
  function submitUpdate(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    const out = {
      id: String(input.id || ''),
      status: input.status == null ? undefined : String(input.status),
      note: input.note == null ? undefined : String(input.note),
    };
    // R42: a record written before the log carried `novelId` can still be
    // pointed at its book by hand. `null`/undefined here means "leave as is";
    // an empty string means "unlink", which is why the presence test is on the
    // property rather than on truthiness.
    if (input.novelId !== undefined) out.novelId = String(input.novelId || '');
    return api('submit.update', out);
  }

  /** Reads one outgoing attachment back as text so ③ 预览 can show it. */
  function submitAttachment(payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    return api('submit.attachment', {
      name: String(input.name || ''),
      base64: String(input.base64 || ''),
    });
  }

  function smtpStatus() {
    return api('smtp.status', {});
  }

  function smtpConfigure(config) {
    const input = config && typeof config === 'object' ? config : {};
    return api('smtp.configure', {
      host: String(input.host || ''),
      port: Number(input.port) || 465,
      secure: input.secure !== false,
      user: String(input.user || ''),
      password: input.password == null ? '' : String(input.password),
    });
  }

  function smtpTest() {
    return api('smtp.test', {});
  }

  /** Provider presets (QQ/163/Gmail/…) for the one-click fill buttons. */
  function smtpPresets() {
    return api('smtp.presets', {});
  }

  // ---- inbox (收件箱) -------------------------------------------------------
  // The replies to a submission land in the same mailbox the author sends from,
  // so the settings dialog only has to ask for an IMAP host once.
  function imapStatus() {
    return api('imap.status', {});
  }

  function imapConfigure(config) {
    const input = config && typeof config === 'object' ? config : {};
    const payload = {
      host: String(input.host || ''),
      port: Number(input.port) || 993,
      secure: input.secure !== false,
      user: String(input.user || ''),
      password: input.password == null ? '' : String(input.password),
    };
    if (input.enabled !== undefined) payload.enabled = input.enabled === true;
    if (input.useSmtp !== undefined) payload.useSmtp = input.useSmtp !== false;
    if (input.clearPassword !== undefined) payload.clearPassword = input.clearPassword === true;
    return api('imap.configure', payload);
  }

  function imapTest() {
    return api('imap.test', {});
  }

  function imapPresets() {
    return api('imap.presets', {});
  }

  /** Newest messages of INBOX, headers + snippet, for the home screen. */
  function inboxList(options) {
    const input = options && typeof options === 'object' ? options : {};
    return api('inbox.list', { limit: Number(input.limit) || 12 });
  }

  /** One message in full, by uid. The list only carries a 160-char snippet. */
  function inboxRead(uid) {
    return api('inbox.read', { uid: Number(uid) || 0 });
  }

  /** R16 ⑤: drops one message from the mailbox (mark \Deleted + expunge). */
  function inboxDelete(uid) {
    return api('inbox.delete', { uid: Number(uid) || 0 });
  }

  /** Editorial advice (not typo fixes) on one chapter. */
  function revise(input) {
    const body = input && typeof input === 'object' ? input : {};
    const payload = { text: String(body.text == null ? '' : body.text) };
    if (body.provider) payload.provider = String(body.provider);
    if (body.model) payload.model = String(body.model);
    if (body.focus) payload.focus = String(body.focus);
    if (body.note) payload.note = String(body.note);
    return api('revise', payload);
  }

  // ---- LAN sync / pairing (R34) ---------------------------------------------
  // The phone talks to the host over HTTP; these wrappers are what the desktop
  // side of that conversation calls, so both ends speak the same method names.

  /** Shows a pairing QR: `{payload, svg, token, expiresAt, addresses, port}`. */
  function pairStart() {
    return api('pair.start', {});
  }

  function pairStatus() {
    return api('pair.status', {});
  }

  function pairCancel() {
    return api('pair.cancel', {});
  }

  function pairAccept(input) {
    const body = input && typeof input === 'object' ? input : {};
    return api('pair.accept', {
      token: String(body.token || ''),
      deviceId: String(body.deviceId || ''),
      deviceName: String(body.deviceName || ''),
      publicKey: String(body.publicKey || ''),
      address: String(body.address || ''),
    });
  }

  function peersList() {
    return api('pair.peers', {});
  }

  function peerRemove(id) {
    return api('pair.remove', { id: String(id || '') });
  }

  function lanInfo() {
    return api('pair.info', {});
  }

  /**
   * Pushes the whole library into the host's sync mirror.
   *
   * `books` is `[{id,title,author,updatedAt,deleted,chapters}]` — the same shape
   * the merge engine and the phone use. Sending the library whole (rather than a
   * diff) keeps the contract honest: book-level LWW needs both sides' timestamps,
   * and a delta would have to reconstruct them anyway.
   */
  function syncPush(books) {
    return api('sync.push', { books: Array.isArray(books) ? books : [] });
  }

  function syncPull() {
    return api('sync.pull', {});
  }

  function syncApply(books) {
    return api('sync.apply', { books: Array.isArray(books) ? books : [] });
  }

  NW.apiUrl = apiUrl;
  NW.api = api;

  NW.io = {
    pickFiles: pickFiles,
    importFile: importFile,
    exportProject: exportProject,
    exportAll: exportAll,
    download: download,
    exportBackupJson: exportBackupJson,
    importBackupJson: importBackupJson,
    saveBackup: saveBackup,
    ping: ping,
    toBase64: toBase64,
    fromBase64: fromBase64,
    library: {
      get: libraryGet,
      set: librarySet,
      mirror: libraryMirror,
      pick: libraryPick,
      restore: libraryRestore,
      list: libraryList,
      decryptTo: libraryDecryptTo,
    },
    journals: {
      list: journalsList,
      save: journalsSave,
      remove: journalsRemove,
      newId: journalsNewId,
      recommend: journalsRecommend,
      email: journalsEmail,
      importEmails: journalsImportEmails,
    },
    submit: {
      prepare: submitPrepare,
      send: submitSend,
      record: submitRecord,
      update: submitUpdate,
      attachment: submitAttachment,
      recommend: journalsRecommend,
      smtpStatus: smtpStatus,
      smtpConfigure: smtpConfigure,
      smtpTest: smtpTest,
      smtpPresets: smtpPresets,
    },
    inbox: {
      status: imapStatus,
      configure: imapConfigure,
      test: imapTest,
      presets: imapPresets,
      list: inboxList,
      read: inboxRead,
      remove: inboxDelete,
    },
    pair: {
      start: pairStart,
      status: pairStatus,
      cancel: pairCancel,
      accept: pairAccept,
      peers: peersList,
      remove: peerRemove,
      info: lanInfo,
    },
    sync: {
      push: syncPush,
      pull: syncPull,
      apply: syncApply,
    },
  };

  NW.ai = {
    models: models,
    proofread: proofread,
    revise: revise,
    selftest: selftest,
    // R34: failover-aware variants. `proofread` / `revise` stay bare so the
    // dialogs that manage their own picker keep exact control.
    proofreadSafe: proofreadSafe,
    reviseSafe: reviseSafe,
    candidates: modelCandidates,
  };

  /**
   * R29: the same starter brief the Host ships with, shown in the settings
   * hint. Duplicated on purpose — reading it back from the Host would need a
   * round trip to render a hint, and a stale copy in the hint is harmless while
   * a missing one looks broken.
   */
  NW.aiProofreadDefaultRules = function aiProofreadDefaultRules() {
    return '只找确凿的错别字、词语误用、标点错误与重复字；不改风格、不改剧情、不调整人称或时态；没有把握的地方一律不报。';
  };
})();
