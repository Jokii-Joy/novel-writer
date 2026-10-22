# Novel Studio plugin — build & interface contract

Authoritative contract for every part of `@local/novel-writer`.
Read this fully before writing code. Do not change files outside your assigned scope.

Workspace root for this bundle: `C:\Users\17737\Desktop\dsh\编码区\novel-writer`

## 0. Hard rules

- No new dependencies. Host half may use **only** Node builtins (`node:zlib`, `node:crypto`, `node:fs`, `node:path`, `node:https`, `node:http`, `node:url`, `node:buffer`).
- Client half is plain browser JS. **No import/export statements, no JSX, no TypeScript, no `require` except `react`.**
- Client half must not `require('@deepseek-ai/dsh-client-ui-primitives')` or any other host package. Do not touch `document.body`. Do not create iframes.
- Style only with `--dsw-alias-*` / `--dsw-specific-sidebar-fill` theme tokens for host chrome. The writing surface may use its own 4 reading palettes through CSS variables owned by the editor.
- Every user-visible string goes through `NW.t('中文')` (see §5). Prefer Chinese as the key.
- All IDB writes must be resilient: never throw on a missing record; return `undefined`/no-op.
- Do not edit `client/client.js` by hand — it is generated.

## 1. Client bundle build

Sources live in `client/src/*.js`. `node scripts/build-client.mjs` concatenates them in
lexicographic filename order between `00-boot.js` and `99-end.js` and writes `client/client.js`.

- `00-boot.js` opens the loader wrapper: `window.__ModuleLoader__.load({ id: '@local/novel-writer', factory(require) { const React = require('react'); const h = React.createElement; const NW = {}; ...`
- `99-end.js` closes it: `return { inject: ['slots'], apply: NW.apply }; } });`
- **Every other part file must be exactly one top-level statement wrapped like this:**

```js
;(() => {
  'use strict';
  // ... local helpers ...
  NW.myThing = { /* ... */ };
})();
```

Rule: no top-level `const`/`function`/`let` declarations in a part file outside its IIFE wrapper,
because all parts share one function scope. Variables available inside a part:
`React`, `h`, `NW`. (`ctx` is stored by the app as `NW.ctx` after `apply(ctx)` runs.)

- Each part that ships CSS pushes a string: `NW.CSS_PARTS.push('...')`.
- The app renders one `<style>` with `NW.CSS_PARTS.join('\n')`.

Files and owners:

| File | Owner | Provides |
|---|---|---|
| `client/src/00-boot.js` | lead | wrapper open |
| `client/src/05-css.js` | lead | `NW.CSS_PARTS` base tokens/helpers |
| `client/src/07-locale.js` | lead | `NW.t`, locale dict registration |
| `client/src/40-ui.js` | lead | `NW.ui` primitives |
| `client/src/90-app.js` | lead | `NW.App`, `NW.apply`, panel wiring |
| `client/src/95-dialogs.js` | lead | settings / backup / proofread / typeset / lock screens |
| `client/src/99-end.js` | lead | wrapper close |
| `client/src/10-db.js` | client-core | `NW.db` |
| `client/src/15-crypto.js` | client-core | `NW.crypto` |
| `client/src/20-format.js` | client-core | `NW.format` |
| `client/src/30-io.js` | client-core | `NW.io`, `NW.ai`, `NW.cloud`, `NW.api` |
| `client/src/50-shelf.js` | shelf | `NW.Shelf` |
| `client/src/60-editor.js` | editor | `NW.Editor` |

## 2. Slot registration (lead)

Registers in `sidebar.panellist` (id `novel-writer`, order 5) and `main` (key `novel-writer`).
The sidebar entry is an inline SVG mark. Panel component props: `{ size, active }` for the
panellist; the `main` entry renders `NW.App`.

## 3. Client → Host transport (`NW.api`)

```js
NW.api(method, payload)  // → Promise<data>, rejects Error(message) on {ok:false}
NW.apiUrl(path)          // same-origin URL respecting document.baseURI prefix
```

Wire: `POST <base>novel-writer/api/<method>` with JSON body, `Content-Type: application/json`.
Reply is always HTTP 200 JSON: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
`GET <base>novel-writer/api/ping` → `{ ok: true, data: { name, version } }`.

Host routes (owner: `host-cloud-ai`, `lib/routes.js`) — exact methods:

```
GET  ping                                   → {name, version, capabilities:{pdf:boolean}}
POST models                                 → {providers:[{id,name}], current:{provider,model}, models:[{provider,id,name}]}
POST proofread   {provider,model,text,mode}  → {suggestions:[{id,start,end,original,replacement,reason,type}]}
POST import.parse {name, base64}             → {title, author, chapters:[{title, content}]}
POST export.build {format, novel:{title,author,chapters:[{title,content}]}, options:{coverBase64?,pageBreak?,includeToc?}}
                                             → {filename, mime, base64}
POST cloud.status                            → {configured, kind:'aliyun'|'webdav'|'none', account, lastSync}
POST cloud.config {kind, fields}             → {ok}
POST cloud.login                             → {state:'pending', url, deviceCode?} | {state:'ok', account}
POST cloud.poll {deviceCode}                 → {state:'pending'|'ok'|'error', account?, message?}
POST cloud.disconnect                        → {}
POST cloud.list                              → {items:[{id,name,size,modified}]}
POST cloud.upload {name, base64}             → {id, name, size}
POST cloud.download {id}                     → {name, base64}
POST selftest                                → {results:[{name, ok, detail}]}
```

Chapter title detection for import: a line matching
`^\s*(?:第[零一二三四五六七八九十百千万两0-9]+[章节回卷篇部集]|Chapter\s+\d+|序章|楔子|尾声|后记|番外|(?:[0-9]{1,4})[、.．]\s*\S)`
starts a new chapter; text before the first match becomes chapter 1 (`title` from the first line if short, else the novel title).

## 4. Host module contracts

`index.js` (lead) is the plugin entry: `export function apply(ctx)`; it resolves optional services
(`webServer`, `llm`, `officeToPdf`, `agentDefaultModel`, `credentials`) with `ctx.get(...)` and calls
`registerRoutes(ctx, { services })` from `lib/routes.js`, wrapping it in `ctx.effect` so disposal works.

- `lib/zip.js` → `zipSync(files: Record<string, string|Uint8Array>, opts?: {store?: string[]}) : Buffer`,
  `unzipSync(buf: Buffer|Uint8Array) : Map<string, Buffer>` (supports stored + deflated entries, no zip64, no encryption).
- `lib/docx.js` → `buildDocx({title, author, chapters:[{title,content,level?}], options}) : Buffer`,
  `parseDocx(buf) : {title, author, paragraphs:[{text, style}]}`.
- `lib/epub.js` → `buildEpub({title, author, language, chapters, options}) : Buffer`,
  `parseEpub(buf) : {title, author, chapters:[{title, content}]}`.
- `lib/pdf.js` → `docxToPdf(ctx, docxBytes) : Promise<Buffer>`.
  Try `ctx.get('officeToPdf')`: `convert({ extension:'docx', priority:'foreground', source:{ key:'novel-'+randomuuid, version:'1', read: async()=>({bytes, version:'1'}) } })` → `.pdf`.
  Fallback: dynamic `import()` of the unpacked `@deepseek-ai/libreoffice-kit` package found under
  `path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js')`
  or `process.resourcesPath`. If nothing works, throw `Error('PDF 引擎不可用')` (routes maps it to a friendly message).
- `lib/import-parse.js` → `parseImport({name, bytes}) : Promise<{title, author, chapters}>` dispatching on extension.
- `lib/ai.js` → `listModels(ctx) : Promise<{providers, current, models}>`,
  `proofread(ctx, {provider, model, text, mode, signal}) : Promise<{suggestions}>`.
  `ctx.llm.stream({provider, model, messages, system, signal, maxTokens})` yields chunks; collect `text-delta`.
  Ask for strict JSON; parse with a tolerant extractor (strip ``` fences, find first `{`/last `}`), validate offsets against `text`
  (drop suggestions whose `original` does not match `text.slice(start,end)`; repair by searching the original string).
- `lib/cloud.js` → state machine over `aliyun` (OAuth2 + openapi.alipan.com) and `webdav` (HTTP PUT/GET/PROPFIND), local secret storage.
- `lib/secrets.js` → `loadSecrets(): Promise<object>`, `saveSecrets(obj): Promise<void>`; AES-256-GCM at rest with a random key file (mode 0600) under `DSH_HOME/novel-writer/`. Never hardcode keys.
- `lib/routes.js` → `registerRoutes(ctx, services) : () => void`.

Host data directory: `path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'novel-writer')`
(create recursively on demand; `backups/`, `secrets/`).

## 5. Shared client namespace

### `NW.t(key)` — lead
Returns the localized string for `key` (Chinese key, English dict where available).

### `NW.ui` — lead (`40-ui.js`)

```js
NW.ui.btn({ children, onClick, kind?:'primary'|'ghost'|'danger'|'icon', title?, disabled?, active?, style? })  // React element
NW.ui.iconBtn(label, title, onClick)          // compact ghost button
NW.ui.field({ label, children, hint? })       // labelled row wrapper
NW.ui.input({ value, onChange, placeholder?, style?, type?, onKeyDown?, autoFocus? })
NW.ui.select({ value, onChange, options:[{value,label}], style? })
NW.ui.toggle({ checked, onChange, label? })
NW.ui.modal({ title, children, onClose, footer?, width? })   // portal-free overlay inside our root
NW.ui.confirm(text, { danger? }) : Promise<boolean>
NW.ui.prompt({ title?, label?, value?, placeholder?, multiline? }) : Promise<string|null>
NW.ui.toast(message, kind?:'info'|'ok'|'error')   // App renders these
NW.ui.spinner(label?)
NW.ui.empty(text)
NW.ui.listRow({ icon?, title, meta?, active?, onClick, actions?:ReactNode })
```

`NW.ui` never needs `ctx`. All components are plain function components.

### `NW.db` — client-core (`10-db.js`)

IndexedDB database `novel-writer`, version 1. Stores: `novels`(keyPath id), `chapters`(keyPath id),
`versions`(keyPath id, index byChapterId), `trash`(keyPath id), `settings`(keyPath key).

```js
NW.db.init() : Promise<void>
NW.db.subscribe(fn) : () => void                 // called after every mutation, debounced by caller
// novels
NW.db.listNovels() : Promise<Novel[]>
NW.db.getNovel(id) : Promise<Novel|undefined>
NW.db.createNovel({title, author?}) : Promise<Novel>
NW.db.updateNovel(id, patch) : Promise<Novel|undefined>
NW.db.deleteNovel(id) : Promise<void>            // → trash
// chapters
NW.db.listChapters(novelId) : Promise<Chapter[]>  // ordered by (parentId, order)
NW.db.getChapter(id) : Promise<Chapter|undefined>
NW.db.createChapter(novelId, {title, parentId?}) : Promise<Chapter>
NW.db.updateChapter(id, patch) : Promise<Chapter|undefined>   // title/parentId/order
NW.db.deleteChapter(id) : Promise<void>          // → trash (children too)
NW.db.saveChapterContent(id, content) : Promise<void>         // encrypts when NW.crypto.encryptionOn()
NW.db.moveChapter(id, parentId|null, orderIndex) : Promise<void>
// history
NW.db.saveVersion(chapterId, content) : Promise<void>         // keeps last 50 / chapter
NW.db.listVersions(chapterId) : Promise<Version[]>            // newest first
NW.db.getVersion(id) : Promise<Version|undefined>
// trash
NW.db.listTrash() : Promise<TrashItem[]>
NW.db.restoreTrash(id) : Promise<void>
NW.db.emptyTrash() : Promise<void>
// settings
NW.db.getSettings() : Promise<Settings>          // merged over defaults
NW.db.saveSettings(patch) : Promise<Settings>
```

Records (plain objects, JSON-serializable):
```js
Novel   = { id, title, author, description, cover: string|null(dataURL), createdAt, updatedAt }
Chapter = { id, novelId, parentId: string|null, title, content, order, createdAt, updatedAt,
            wordCount, readOnlyWordCount? }
Version = { id, chapterId, content, words, createdAt }
TrashItem = { id, kind:'novel'|'chapter', payload, deletedAt, title }
Settings = { fontFamily, fontSize, lineHeight, pageWidth, theme:'light'|'dark'|'eye'|'parchment',
             typewriter:boolean, autoSaveMs:number, proofreadModel:{provider,model}|null,
             autoLockMinutes:number, lockEnabled:boolean, encryption:boolean,
             exportFormat:'docx'|'pdf'|'epub'|'txt', backup:{kind,autoSync,lastSync}, shortcuts:{} }
```
`wordCount` is stored at save time (`NW.format.wordCount`). `updatedAt` is epoch ms (number).

### `NW.crypto` — client-core (`15-crypto.js`)

```js
NW.crypto.hasPassword() : Promise<boolean>
NW.crypto.setPassword(pw) : Promise<void>          // PBKDF2-SHA256 210000 iters, random salt, verifier only
NW.crypto.clearPassword(pw) : Promise<boolean>
NW.crypto.unlock(pw) : Promise<boolean>            // derives in-memory keys; sets localStorage 'nw.locked'='0'
NW.crypto.lock() : void                            // wipes in-memory keys; localStorage 'nw.locked'='1'
NW.crypto.isLocked() : boolean                     // true when no password set? NO: false when no password
NW.crypto.isUnlocked() : boolean
NW.crypto.encryptionOn() : Promise<boolean>        // settings.encryption && unlocked
NW.crypto.encryptText(s) : Promise<string>         // 'enc:v1:<ivB64>:<ctB64>' (AES-GCM 256)
NW.crypto.decryptText(s) : Promise<string>
NW.crypto.idleMs() : number                        // ms since last activity (updated by NW.crypto.touch())
NW.crypto.touch() : void
```
Lock policy: when a password exists and `localStorage['nw.locked'] !== '0'`, the panel opens locked
(this survives harness restart). Auto-lock after `settings.autoLockMinutes` of no `touch()`.

### `NW.format` — client-core (`20-format.js`)

```js
NW.format.wordCount(text) : number        // CJK chars counted individually + latin words
NW.format.typeset(text, opts) : {text, edits:[{kind, before, after, index}]}
NW.format.diffPreview(a, b) : Array<{type:'same'|'add'|'del', text}>   // line-level
NW.format.autoChapterSplit(text, fallbackTitle) : [{title, content}]   // for txt/md import
NW.format.markdownToPlain(text) : string
NW.format.applyEdits(text, edits, acceptedIds) : string   // apply accepted {start,end,replacement} right-to-left
```
`typeset` rules: normalize full-width punctuation, unify `……`/`——`, straight→curly quotes for Chinese context,
two-char paragraph indent (`　　`), collapse 3+ blank lines to one, normalize chapter headings to `第一章 标题`,
dialogue lines each on their own paragraph, strip trailing spaces. Every change is recorded in `edits`.

### `NW.io` / `NW.ai` / `NW.cloud` — client-core (`30-io.js`)

```js
NW.api(method, payload) : Promise<any>
NW.apiUrl(path) : string
NW.io.pickFiles(accept) : Promise<File[]>            // <input type=file> helper
NW.io.importFile(file) : Promise<{title, author, chapters}>   // txt/md client-side, docx/epub via host
NW.io.exportProject(novel, format, options) : Promise<void>   // builds via host, triggers download
NW.io.download(name, blob)
NW.io.exportBackupJson() : Promise<Blob>             // full snapshot of every store
NW.io.importBackupJson(blob) : Promise<void>
NW.ai.models() : Promise<{providers, current, models}>
NW.ai.proofread({provider, model, text, mode}) : Promise<{suggestions}>
NW.cloud.*                                           // thin wrappers over the cloud.* routes
```

### `NW.Editor` — editor (`60-editor.js`)

```js
NW.Editor({ chapter, settings, onSave(content, immediate), onSelectionChange(sel), registerApi })
```
- `<textarea>`-based Markdown editor; `value` is the chapter content; calls `onSave` after
  `settings.autoSaveMs` debounce and on blur/`Ctrl+S`.
- Applies `settings.fontFamily/fontSize/lineHeight/pageWidth` and `theme` via CSS vars on its root:
  `--nw-font`, `--nw-size`, `--nw-line`, `--nw-width`.
- Typewriter mode: on input, scroll so the caret's visual line is vertically centred; user wheel/keyboard
  scroll temporarily disables it, next input re-enables. Must work with wrapped lines
  (mirror-div caret measurement, not `lineHeight * lineIndex`).
- Shortcuts: `Ctrl/Cmd+B` bold, `Ctrl/Cmd+I` italic, `Ctrl/Cmd+S` save, `Ctrl/Cmd+F` find/replace,
  `Esc` closes the find bar, `Tab` inserts two full-width spaces.
- Exposes `registerApi({ setContent, replaceRange, focus, scrollTo })` to the app for external edits.
- Pushes `NW.CSS_PARTS`.
- Empty state when `chapter` is null: a centred hint.

### `NW.Shelf` — shelf (`50-shelf.js`)

```js
NW.Shelf({ novels, chapters, activeNovelId, activeChapterId, settings,
           onSelectNovel, onSelectChapter, onCreateNovel, onCreateChapter,
           onRename, onDelete, onMove, onSearch, onOpenSettings })
```
Renders the left column: search box, novel list (each with title, updated date, word count),
expandable chapter tree with indent for `parentId`, drag-and-drop reorder, per-row context actions
(rename/delete/new child), and footer actions (新建小说 / 新建章节 / 回收站 / 设置).
Word counts come from `chapter.wordCount` summed per novel. Must stay usable at 2000+ chapters
(no per-row effects; plain memo-free rendering is fine, avoid O(n²) scans in render).
Pushes `NW.CSS_PARTS`.

## 6. App-level state (lead, `90-app.js`)

The app owns: novels/chapters/settings loading, active ids, save status, word counts, toasts,
and dialog visibility. It passes callbacks down. All callbacks are safe against `undefined` data.
Global keyboard: `Ctrl/Cmd+Shift+L` locks the studio.

## 7. Theme / colours

Root `.nw-root` uses `color: var(--dsw-alias-label-primary)`, `background: var(--dsw-alias-bg-base)`,
borders `var(--dsw-alias-border-l1)`. Panel chrome, shelf, toolbar, status bar and dialogs use tokens only.
The editor text surface paints its own reading palette via `.nw-surface[data-theme=light|dark|eye|parchment]`.
