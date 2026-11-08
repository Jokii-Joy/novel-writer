# 精神空间 · 全面审计（R79 审计轮）

> 审计对象：`novel-writer` v1.6.0（commit `df26ed2`，工作树干净）
> 审计日期：2026-11-08
> 方式：静态审读 + 现有自测全跑 + 运行中宿主探测（`http://127.0.0.1:57876`）
> 范围：宿主 `index.js` / `lib/*`、浏览器端 `client/src/*`、Android `app/src/*`（抽样）、
> `scripts/verify-*`、README 与已知限制。
> 结论中「已确认」= 代码路径或现场请求可直接证实；「需复现」= 逻辑成立但依赖时序/环境。

## 摘要（先看这五条）

1. **未设密码的用户，桌面→手机的自动推送是从不执行的死代码**（`90-app.js:1675` 漏了 `await`，
   条件恒真 → 直接 return）。手机同步看起来正常，实际只有手机→电脑一个方向。
2. **从「保存文件夹」恢复会连带清空标注、版本历史、设定集、已接收建议、回收站**——
   快照里没有这五类，`replaceAll` 却先把 9 个 store 全 `clear()`（`10-db.js:1828`）。
3. **IndexedDB 写失败被当成「已保存」**：`writeBatch` 把所有错误吞成 `false`，
   `saveChapterContent` 静默返回，状态栏照常亮「已保存」→ 配额满/多标签页时丢正文。
4. **SMTP/IMAP 的安全降级**：证书校验失败会自动重试「不校验」然后发授权码；
   服务器不声明 STARTTLS 时也照样明文 `LOGIN`/`AUTH PLAIN`。
5. **本地 HTTP 接口可被任意网页跨站盲打**：不校验 `Origin`、接受 `text/plain`，
   而 `library.mirror` 还接受调用方指定的目录——已用只读请求现场验证。

其余为 19 条中等正确性/可靠性问题（§C）、19 条低优先级项（§D）与 10 条性能优化点（§E），
正文逐条给了文件:行号、触发条件、后果与修法。修复顺序见 §G。

> **已修**：A1、A2、A3、B1、B2（R80）、B3、C1–C11、D1–D19（其中 D13 未做焦点陷阱）、E7、E10
> （R81/R82）与 D10。新增 `scripts/verify-async-guards.mjs`、`scripts/verify-restore.mjs`、
> `scripts/verify-crypto-recovery.mjs` 三个回归脚本，并接进 `build-client`。版本 1.6.4。

---

## 0. 先跑一遍现有验收

| 脚本 | 结果 |
| --- | --- |
| `scripts/verify-host.mjs` | **283 / 283 通过**（R79/R80 新增 [8c] 7、路由快照 5、[8d] 12、[8e] 9，R81 新增 [8f] 4） |
| `scripts/verify-advice-ui.mjs` | **42 / 42 通过** |
| `scripts/verify-restore.mjs`（R79 新增） | **16 / 16**：快照缺的 store 不清空、显式空数组仍清空、坏值按缺席处理 |
| `scripts/verify-crypto-recovery.mjs`（R80 新增） | **18 / 18**：密码校验值的宿主备份、清空配置后的恢复与解锁 |
| `scripts/verify-dialog-kinds.mjs` | 14 个 kind 全部解析（`Lock` / `Versions` 注册但无人调用） |
| `scripts/verify-lan-ai.mjs` | **6 / 6 通过**（401 拦截、单飞、能力声明） |
| `scripts/verify-dock-hit.mjs` / `verify-read-spread.mjs` | 全部通过 |
| `scripts/verify-docs.mjs` | 41 通过 / 3 失败 —— 失败是沙箱 `spawn EPERM`（脚本用管道 stdio 起 python），**不是插件缺陷** |
| `scripts/build-client.mjs` | 22 parts，产物与源码一致（git 干净）；现在会串跑 `verify-client-load` 与 `verify-async-guards` |
| `scripts/verify-async-guards.mjs`（R79 新增） | 22 个源文件，`hasPassword()` / `encryptionOn()` 全部 `await` 或 `.then()`；用故意写坏的探针验证过会失败 |
| 运行中宿主 `POST /selftest` | 7 项全绿；`journals` 68 家（内置 79，用户删了 11） |

现有测试质量很高，但覆盖集中在宿主纯函数与合并规则。下面列出的问题基本都在**测试覆盖不到的地方**
（浏览器状态、并发、恢复语义、安全边界）。

---

## A. 严重：会静默丢数据 / 功能整体失效

### A1【已确认】没设密码的用户，桌面→手机的同步推送从未执行

`client/src/90-app.js:1675`

```js
if (NW.crypto.hasPassword && NW.crypto.hasPassword() && !NW.crypto.isUnlocked()) return null;
```

`hasPassword()` 是 **async**（`client/src/15-crypto.js:166`），这里没有 `await` → 返回 Promise 恒为真；
而 `isUnlocked()` 是 `!!cachedKey`（`15-crypto.js:298`），只有 `setPassword` / `unlock` 才会赋值。
于是**没设密码的安装**：`Promise(真) && !false` 恒成立 → 函数第一行就 `return null`，`NW.io.sync.push`
成为死代码，且 catch 把一切错误吞掉，界面上只显示「还没有同步过」。

同文件其它三处调用都写了 `await`（`90-app.js:1317/2756/2813`），只有这一处漏了——
基本可以判定是 R36（`c63d763`，为「正文加密 + 手机同步」加守卫）时的笔误，此后一直带到现在。

- 触发：任意未设密码的用户（最主流的情况）打开写作页，修改任何一章。
- 后果：宿主 `sync-state.json` 永不更新；手机拉到的永远是旧稿/空库。**手机同步看起来是好的，实际单向失效。**
- 修法：
  ```js
  const hasPw = NW.crypto && typeof NW.crypto.hasPassword === 'function' && (await NW.crypto.hasPassword());
  if (hasPw && !NW.crypto.isUnlocked()) return null;
  ```
  顺手把 `hasPassword` 改成同步导出（或加 `hasPasswordSync` 导出）更省事。
- **状态：已修**（R79 工作区）。`syncLibrary` 的守卫改成 `await`；另新增
  `scripts/verify-async-guards.mjs`（已接进 `build-client`），静态拦截
  「async 助手当布尔用」的写法，并用一条故意写坏的探针验证过它确实会失败。

### A2【已确认】从「保存文件夹」恢复会清空标注 / 版本 / 设定集 / 已接收建议 / 回收站

三处拼起来才看出后果：

1. 文件夹快照只装四样东西：`lib/routes.js:770-780` 组装 `extra = {chapters, settings, notes, submissions}`，
   `lib/library.js:625-636` 只把这四个 key 写进 `library.json`；
2. 客户端恢复时 `client/src/95-dialogs.js:1338` 调 `NW.db.replaceAll(snapshot)`；
3. `replaceAll`（`client/src/10-db.js:1825-1850`）对 `STORES` 里 **9 个 store 先 `clear()` 再按快照回填**，
   而快照里没有 `marks / versions / lore / revisions / trash`。

```js
// 10-db.js:1828
for (let s = 0; s < STORES.length; s += 1) {
  const store = STORES[s];
  ops.push({ store: store, type: 'clear' });
  ...
}
```

- 触发：设置 → 存稿与备份 → 「恢复…」（从文件夹恢复，`95-dialogs.js:1506`）。
- 后果：章下划线/删除线/批注（R52）、版本历史（R77 刚加的「对比当前」）、**设定集**（R77 人物/地点/道具）、
  已接收的修改建议、回收站——**全部被清空且无法撤销**。确认框只写「覆盖当前全部小说与章节」
  （`95-dialogs.js:1356`），用户完全不知道这几样会没。
- 补充：R77 的设定集在 `db.dump()` 里有（`10-db.js:1806`），但 `mirrorLibrary` 的 payload 没带
  （`90-app.js:1801-1816`），宿主的白名单也不认——所以「先备份进文件夹、再恢复」这条路对设定集必然丢失。
- 修法（两条一起做才闭环）：
  - 宿主：`handleLibraryMirror` 的 `extra` 加 `marks/versions/lore/revisions/trash`，
    `library.mirrorLibrary` 的白名单同步加；`handleLibraryRestore` 原样回传。
  - 客户端：`restoreSnapshot` 用「合并式恢复」而不是 `replaceAll`；
    或至少让 `replaceAll(snapshot, {preserveMissing: true})`：快照缺哪个 key 就保留该 store 现状，
    并在确认框里逐项列出「将保留/将覆盖」。
  - 兜底：确认框文案改成实际的清单，别只写「小说与章节」。
- **状态：已修**（R79 工作区），按「两步一起」落地：
  - `client/src/10-db.js` 新增纯函数 `planRestore`（导出为 `NW.db.planRestore`）：**快照里没有的
    store 一律不清空**，显式空数组仍然清空，`null` / 非数组这类坏值按「没带」处理。
    `replaceAll` 改为按它生成 ops，全部 store 缺席时直接 no-op。
  - 文件夹快照补上 `marks / lore / revisions`：`90-app.js` 的 payload、`30-io.js` 的包装层、
    `lib/routes.js` 的 `extra` 白名单、`lib/library.js` 的 `mirrorLibrary` 一起改；
    版本历史与回收站**仍不写进快照**（体积取舍），靠上面的保留规则保证不被清掉。
  - 恢复确认框与结果提示改成实际清单（`95-dialogs.js`）。
  - 回归：`scripts/verify-restore.mjs` 16 项（已接进 `build-client`）；`verify-host.mjs` 新增
    路由级快照断言与 [8c]，共 258 项。

### A3【已确认】IndexedDB 写失败被当成「已保存」

```js
// client/src/10-db.js:328-362
function writeBatch(ops) { ... .catch(() => false); }     // 所有错误都吞成 false
// client/src/10-db.js:982
const ok = await writeBatch([...]);
if (!ok) return;                                          // 静默返回 undefined
// client/src/90-app.js:2037-2050
await NW.db.saveChapterContent(targetId, text);
setSaveState(dirtyDuringSaveRef.current ? 'dirty' : 'saved');   // 失败也走到这里
```

- 触发：配额超限（版本表/回收站积累）、另一个标签页 `onversionchange` 关了连接、事务 abort。
- 后果：状态栏亮「已保存」、字数刷新、`lastSavedRef` 前进——正文只活在内存里，切章或刷新即丢。
- 修法：`writeBatch` 失败时 `throw`（或返回结构化错误），`saveChapterContent` 把失败往上抛；
  `saveChapter` 的 `catch` 分支已经会把状态置为 `'error'`，让错误真正走到那里即可。
- **状态：已修**（R79 工作区）。只改了正文保存这一条路径（`saveChapterContent` 在 `writeBatch`
  返回 `false` 时抛错），避免一次动到 `writeBatch` 的 40 个调用点；导入路径本来就有 try/catch，
  失败会明说「导入失败」而不是静默丢字。`writeBatch` 全局返回结构化错误的清理仍留给后续一轮。

---

## B. 安全

### B1【已确认】SMTP / IMAP 证书校验失败会自动降级为「不校验」，然后继续发密码

```js
// lib/smtp.js:210-212
if (rejectUnauthorized && isCertificateFailure(error)) {
  this.certBypassed = true;
  this.socket = await openSocket({ ...shape, rejectUnauthorized: false });
}
```

`lib/imap.js:255-257`、`283-289` 同样。降级之后 `authenticate()` 立刻用 AUTH PLAIN 发送
`\0user\0授权码`（`smtp.js:345-347`），IMAP 用 `LOGIN`（`imap.js:351`）。
证书错误恰恰是中间人代理最典型的特征——这条「容错」把**邮件授权码**（以及之后整篇稿件附件）
交给了一个未验证的对端。讽刺的是 `certBypassed` 只在连接成功**之后**的提示里出现。

- 修法：默认不降级；降级必须显式（`settings.smtp.allowInsecureTls = true`，在设置页用红字确认），
  或者至少**在发送 AUTH 之前**中断并回报 `smtp-cert-untrusted`，让用户决定。
- **状态：已修（R80）**：`smtp.js` / `imap.js` 不再自动降级；证书失败直接返回
  `smtp-cert-untrusted` / `imap-cert-untrusted`，仅在设置里显式打开「允许跳过证书校验」后才重试一次，
  且 `certBypassed` 会在结果里如实回报。设置页两个开关都标了「不推荐」。

### B2【已确认】服务器不提供 STARTTLS 时，仍以明文完成认证与投递（STARTTLS 剥离）

```js
// lib/smtp.js:595-598
if (!config.secure && config.port !== 465 && session.supports('STARTTLS') && config.starttls !== false) {
  await session.command('STARTTLS', [220]);
  await session.upgradeTls();
}
// 没有 STARTTLS → 直接往下走，authenticate() 照发
```

IMAP 侧注释写得很清楚「Plain 143 must be upgraded before LOGIN, otherwise the password travels in
the clear」（`imap.js:274`），但代码只在**服务器主动声明 STARTTLS**时升级（`imap.js:276-293`），
没声明就照样 `LOGIN`。经典 STARTTLS stripping：中间人删掉 EHLO/CAPABILITY 里的能力位即可。

- 修法：只要配置了 `user/pass`，且最终连接不是 TLS，就拒绝认证（`tls-required`），
  除非用户显式打开「允许明文」；并把这一条写进已知限制。
- **状态：已修（R80）**：`smtp.requiresTls` / `imap.requiresTls` 两条纯策略函数负责判断，
  明文连接 + 有凭据时直接中止（`smtp-tls-required` / `imap-tls-required`），
  只有显式打开「允许明文登录」才放行；`verify-host` 的 [8e] 9 项钉住这四种组合。

### B3【已确认】本地 HTTP 接口无 Origin/CSRF 校验，跨站 `text/plain` 可直接触发写操作

现场验证（只读方法，未造成修改）：

```bash
curl -X POST http://127.0.0.1:57876/novel-writer/api/library.get \
  -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data '{}'
# → HTTP/1.1 200 OK  + 完整数据（没有任何 CORS 头，也没有拒绝）
```

`lib/routes.js:136-149` 的 `parseJsonBody` 不看 `Content-Type`；`createHandler`
（`routes.js:3091-3119`）不看 `Origin`/`Sec-Fetch-Site`。浏览器对 `text/plain` 的跨站 POST
不预检，于是任何用户访问的网页都能「盲发」副作用：

- `library.mirror`（`routes.js:762-784`）**接受调用方指定的 `dir`** —— 可向任意绝对路径写 `.docx` / `library.json`；
- `submit.send`（`routes.js:2517`）用用户已保存的邮箱**发任意收件人的邮件**；
- `smtp.configure` / `imap.configure` / `library.set` 覆盖配置。

Chrome 的 Private Network Access 有时会挡一层，Firefox 与部分嵌入环境没有；同机其它本地页面更不受限。
这是纵深防御问题，但后果不轻。

- 修法：写操作要求 `Content-Type: application/json`（强制预检）+ 校验 `Origin`（缺失或同源才放行）
  + 可选的一次性 nonce 头；`library.mirror/library.restore/decryptTo` 的 `dir` 只允许当前设置里的目录
  （`payload.dir` 与 `settings.dir` 不一致就拒绝）。

---

## C. 正确性与可靠性（中）

### C1【已确认】保存文件夹的写入不是原子的，且没有串行化

`lib/library.js:412-425` 的 `writeTextFile` / `writeBytesFile` 都是直接 `fsp.writeFile(target, ...)`：
`.docx` 与 `library.json` 原地覆盖。磁盘满、进程被杀、断电 → 留下半截 Word / 半截快照；
而 `library.json` 是唯一的可恢复入口，`previousSnapshot` 读不出来就再也清不掉旧文件。
另外 `mirrorLibrary` 没有锁（`lansync` 那套 `withStateLock` 只保护 sync-state），
「自动保存（1.2s 防抖）」「设置页立即保存」「换目录时的整库写」三者可以同时跑，
互相删对方的 `stalePlain` / 旧名字文件。

- 修法：写临时文件 + `rename`（照抄 `writeSettingsAtomic` / `lansync.writeTextAtomic`）；
  给 `mirrorLibrary` 加一把模块级队列；快照最后写。

### C2【已确认】增量保存的签名漏了便签与投稿记录

`client/src/90-app.js:1848-1855` 的 `autosaveSignature` 只有 `novels + chapters + encrypt`；
`1888-1890` 一旦「没有书变化」就直接 `return`。于是：

- 只改**灵感便签**（notes）→ 文件夹里的 `library.json.notes` 不更新；
- 「投稿管理」里改了状态（host `submissions.json`）→ 快照里的 `submissions` 不更新；
- 只改**设定集**（lore）→ 根本不进快照（见 A2）。

下次恢复就拿到旧便签、旧投稿状态。R78 修了「mirror 包装层丢 notes/submissions」，
但触发条件没修，等于改了一半。

- 修法：签名加 `notes`/`submissions`/`settings` 的摘要；它们变化时不走 `changed` 增量
  （宿主本来就会每次都重写 `library.json`，这里只需让定时器**真的调用一次**）。

### C3【已确认】`settings.json` 的读-改-写没有锁，并发会互相覆盖

`lib/library.js:194-208` 是 `readSettings() → merge → writeSettingsAtomic`，全过程无队列。
而写它的入口有 5 个：设置页（dir/mirror/encrypt）、期刊库（`journals.save`）、
SMTP / IMAP 配置、以及**每次自动保存**的 `lastMirrorAt`（`routes.js:786-787`）。
后者的频率是 1.2 秒一次——用户点「保存期刊」时正好撞上一次 `lastMirrorAt` 写入，
就会把期刊表整段改回旧值（或反过来把 `lastMirrorAt` 回退）。

- 修法：给 `writeSettings` 加一个和 `secrets.enqueue` 同款的写队列；
  `lastMirrorAt` 改成内存节流（≥ 30s 或退出时）落盘。

### C4【已确认】章节整行读-改-写竞态：改名可能把正文写回旧版本

`client/src/10-db.js:751-789`（`updateChapter`）与 `934-986`（`saveChapterContent`）
都是「先 `readOne` 整行 → 改字段 → `put` 整行」，中间都有 `await`：

1. 用户在目录树里改标题 → 读到 `content = A`；
2. 1.2s 防抖的自动保存写入 `content = B`；
3. 改名那笔 `put` 落地，把 `content` 覆盖回 `A`。

标题、状态、目标字数、简介都会走这个入口，正好都是「写着写着顺手改一下」的操作。

- 修法：两处都进 `serialise('chapter')` 队列（文件里已有这个队列，`10-db.js:124-132`），
  或把改字段改成在同一个事务里 `get → put`。

### C5【已确认】AI 调用不可取消：关掉窗口后模型继续跑、继续计费

- 客户端全站没有 `AbortController`：`client/src/30-io.js:43-75`（`api`）与 `1047-1121`
  （`reviseSelectionStream`）都无法中止；`withModelFallback` 里对 `code === 'aborted'` 的判断
  （`30-io.js:643`）因此是**死代码**。
- 宿主流式路由也不看连接断开：`lib/routes.js:455-504` 没有 `res.on('close')`/`AbortController`，
  而 `lib/ai.js:946` 的 `reviseSelectionStream` 压根没有 `signal` 参数（`977-983` 调
  `llm.stream` 时没传）——同一文件里的 `reviseSelection`（913-923）是传了的。
- 对比：手机那条路径做对了（`lib/lansync-server.js:332-335` 用 `res.on('close')` → `abort()`）。

后果：选中一段字 → 点「改一版」→ 关窗/刷新 → 宿主机照常把 2400 字一块块跑完；
再点一次又起一条并发请求（`runRef` 只挡 UI，不挡请求）。

- 修法：`api()` 增加 `AbortSignal.timeout(...)`（普通接口 30s，AI 不设或 10min）；
  流式调用返回 `{promise, abort}`；宿主在 `res.on('close')` 时 `controller.abort()` 并把 signal
  一路传到 `llm.stream`。

### C6【已确认】LAN AI 的单飞闸门可能永久卡在 429

```js
// lib/lansync-server.js:314-343
aiBusy = true;
const streaming = opened.json.stream === true;
if (streaming) { res.writeHead(200, {...}); }     // ← 在 try 之外
...
try { ... } finally { aiBusy = false; }
```

`res.writeHead` 抛错（连接已断、头已发）时 `finally` 不会执行 → `aiBusy` 永远为 `true`，
手机端此后每次 AI 请求都收到 429，直到进程重启。

- 修法：把 `writeHead` 挪进 `try`，或在 `aiBusy = true` 后立刻 `try { ... } finally { aiBusy = false }`。

### C7【已确认】ZIP 解压没有输出上限，特制 epub/docx 可以打爆宿主内存

`lib/zip.js:333` `inflateRawSync(raw)` 没传 `maxOutputLength`，只在校验里比较 `usize`。
`usize` 本身来自中央目录、可以被伪造成 4GB；几十 KB 的压缩炸弹就能让 Node 分配几 GB，
宿主进程 OOM（整个 DSH 一起挂）。

- 修法：`inflateRawSync(raw, { maxOutputLength: Math.min(usize || 0, 256 * 1024 * 1024) })`，
  并给单次解压/整套解压设总量上限（如 512MB），超限报 `zip-too-large`。

### C8【已确认】设备身份与 peers 清单的并发保护缺口

- `lib/lansync.js:186-207` `deviceIdentity()` 没有 in-flight 复用：冷启动时 UDP beacon 与手机 ping
  同时调用会各生成一把 Ed25519 密钥、各自写 `device.json`，最后写者赢；拿到旧身份的调用方签出的
  签名与磁盘上的公钥对不上。修法：像 `secrets.js` 那样做 `identityInFlight` 单飞。
- `lib/lansync.js:434-455` `verifyPeer()` 每次认证都**读-改-写整个 peers.json**（只更新 lastSeen），
  `markPeerSync` / `acceptPairing` / `removePeer` 也各写一遍，没有锁。
  解绑一台手机时若正好有一次同步在跑，`verifyPeer` 的旧快照会把被删的 peer 写回来——
  「解绑没生效」就是这么来的。修法：给 peers.json 加写队列；lastSeen 内存化、节流落盘。

### C9【已确认·需复现】`onMarksShift` 不带 chapterId，恢复后可能把标注挪到错章

`client/src/60-editor.js:2591-2601` 在保存时把「上一版 → 这一版」的 diff 交给父组件，
父组件 `90-app.js:2342-2374` 用 **`chapterRef.current`** 去找章节：

```js
const current = chapterRef.current;            // ← 已经是新章了
await NW.db.shiftMarksForEdit(current.id, diff);
```

正常切章路径都会先 `flushEditor()`（`90-app.js:2123`），所以缓冲区早已干净、不会产生 diff。
但 `onRefreshData`（恢复备份 / 同步刷新，`90-app.js:3951-3956`）直接 `setChapter(fresh)` 换章，
旧编辑器在卸载清理里 `flushNow()`（`60-editor.js:4352`）仍会发出最后一次 diff，
此时 `chapterRef.current` 已指向新章 → 新章的标注/已接收建议被按旧章的编辑量整体平移。

- 修法：`onSave` 已经带了 `chapter.id`（`90-app.js:3743`），`onMarksShift` 照抄一个
  `(diff, chapterId)`，父组件用传入的 id；卸载 flush 前确认仍是自己那一章。

### C10【已确认·需复现】新建批注在 pending 期间的最后一句话不会落库

`client/src/62-read.js:708-729`：

```js
if (st.pending) { st.saved = body; return; }   // ← 把新文字记成"已保存"，但没发出去
```

第一次建行是异步的（`p.onMark` 拿到 id 之前），这期间用户继续打字 → 下一次 700ms 提交命中
`st.pending` 分支，把 `st.saved` 更新成新文字就返回；等 id 回来，后续提交看到
`body === st.saved` 直接 `return`。**新文字永远不会写进数据库**。
另外 `776-778` 在 `commitComposer()` 还没 resolve 时就把 `composerSaveRef.current` 整个换掉，
`.then` 里的 `st.id` 写进了已丢弃的旧对象，那条批注的 id 也就丢了。

- 修法：`pending` 分支**不要**更新 `st.saved`（保持 dirty）；重置 ref 前先保留 in-flight 的
  `pending`/`draft`，或把状态改成不可变 + 序号（照抄 92-advice 里 `runRef` 的写法）。

### C11【已确认】`verify-e2e.mjs` 已过时，而且会在真实环境里清掉用户的保存目录设置

`scripts/verify-e2e.mjs` 会对**正在运行的宿主**执行：

```js
await call('library.set', { dir: libDir, mirror: true });   // 覆盖用户设置
...
await call('library.set', { dir: '', mirror: false });      // 结束时把目录清空
```

同时它还引用已删除的 `cloud.*`（R9 移除）、期望 `.md` 镜像（R10 起是 `.docx`）、
期望 selftest 有 6 项（现在是 7 项）。任何人为了「跑一下验收」执行它，都会把用户设置里的
`dir / mirror` 清空，并因为「目录为空」的连带规则把 `encrypt` 一起关掉。

- 修法：要么删掉/重写成「临时 DSH_HOME + 临时 profile」，要么在开头 `library.get` 存档、
  `finally` 里原样恢复，并把过时断言更新。**在修好之前别让用户跑它。**

### C12【已确认】「重新审读」不会清掉上一批卡片的状态，新卡片会顶着旧结论出现

`client/src/92-advice.js:691-704` 的 `run()` 只重置 `busy/error/activeId/fromCache`，
没有清 `decided`、`applied`、`madeRef`；而宿主每次按位次重新编号（`lib/ai.js:673-675` 的
`r1…r8`、`886-888` 的 `s1…s4`）。渲染时 `state: decided[item.id]`、`applied: !!applied[item.id]`
（`92-advice.js:1205-1219`）——换了关注点重读一遍，第 1 张新卡直接显示「已接受」，
「撤销替换」指向上一批的位置。

- 修法：`run()` 开头 `setDecided({}); setApplied({}); madeRef.current = {}`；
  更稳的是把状态 key 换成 `${runToken}:${item.id}`。

### C13【已确认】J/K/A/R 快捷键绕过「已决定」保护，可以重复写入

`92-advice.js:881-921` 的 `acceptItem` 不检查 `decided[item.id]`；`rejectItem` 只改本地状态、
不撤销已写入的行。鼠标路径有 `canDecide` 守卫，键盘路径（`92-advice.js:1036-1065`）没有。
连按两次 A → 「已接收」里同一条建议出现两行；先 A 再 R → 卡片说「已拒绝」，列表里那一行还在。

- 修法：`acceptItem/rejectItem` 先看 `decided[item.id]`；R 时若已写入，先删行再改状态。

### C14【已确认】建议卡片根节点的 keydown 会吞掉子按钮的 Enter / Space

```js
// 92-advice.js:342-346
onKeyDown: (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  ...onReveal(item)
}
```

卡片的「接受 / 拒绝 / 复制 / 替换到正文 / 再改一版」是子按钮，keydown 冒泡到根节点后
`preventDefault()` 取消了按钮的原生激活（Enter 是 keydown 触发 click）。鼠标能用，**键盘全废**；
「已接收」列表里的删除按钮同理（`92-advice.js:561-576`）。

- 修法：`if (ev.target !== ev.currentTarget) return;`，或判断 `ev.target.closest('button')`。

### C15【已确认】只要打开「设置」，就会自动生成一枚配对码（哪怕只是改字号）

`client/src/95-dialogs.js:2906-2916` 把 `PairPanel` 写进了设置弹窗的第 6 个 section；
所有 section 都会挂载（`section()` 只加 `data-on`，由 CSS 隐藏，`95-dialogs.js:2165-2185`），
`PairPanel` 的 boot effect（`4660-4687`）随即 `pair.status()` → 没有有效 offer 就 `pair.start()`。

- 后果：用户只想调字号，`pair.start()` 已经在宿主里铸了一枚 5 分钟有效的配对令牌
  （`lib/lansync.js:243-273`），并渲染在这块被 CSS 藏起来的 DOM 里；关掉设置也不会 `pair.cancel()`。
  局域网监听本身是插件挂载时就开着的（`index.js:61-65` 的设计，见 README 已知限制 32），
  但「配对码」应当是用户走到手机同步那一页才产生的东西。
- 修法：只在 `tab === 'lan'` 时挂载 `PairPanel`（或传 `active` 门控 boot）；
  设置关闭时 `pair.cancel()`；「生成配对码」保持显式或由 LAN 页签触发。

### C16【已确认】从书架导出「不是当前打开的那本书」，导出的却是当前这本

`client/src/50-shelf.js:1081-1089` → `exportTarget`（`90-app.js:3398-3411`）正确带上了
`{kind:'novel', id:B}`；但导出弹窗 `95-dialogs.js:734-735`：

```js
const hasChapter = !!(defaultTarget.kind === 'chapter' && defaultTarget.id);
const target = hasChapter ? defaultTarget : { kind: 'novel', id: String(novel.id || ''), title: novelTitle };
```

`kind:'novel'` 时把 B 的 id 丢掉、换成当前书 A；`exportNow`（`90-app.js:3151-3164`）也
只按 `activeNovelId` 取章节。评论里写的「这个 bug 以前有过」只修了章节那一半。

- 修法：`kind==='novel'` 时保留 `defaultTarget.id/title`；`exportNow` 按 `opts.target.kind==='novel'`
  取对应书的章节（并从 `novels` 里取标题）。

### C17【已确认】新建「设定集」卡第二次保存会再建一张

`client/src/95-dialogs.js:5112-5117`：create 之后只 `setActiveId(created.id)`，`draft.id` 仍是空串，
下一次保存继续走 create 分支 → 两张卡，第一张停在旧内容。`updateLore` 分支永远不会被第一次
保存后的编辑命中。

- 修法：`setDraft((prev) => Object.assign({}, prev, { id: created.id }))`（或用 `created` 回填）。

### C18【已确认】设置项每敲一个键就写一次 IndexedDB 并重渲染整个应用

`95-dialogs.js:1588-1592` 的 `set()` 每次都 `p.onSettings({[key]: value})` →
`applySettings`（`90-app.js:2735-2745`）→ `NW.db.saveSettings`（读整行 + 序列化 + 写）
+ `setSettings`（App 顶层状态）。「文末追加内容」这种长文本框是**每键一次整库读改写**，
字号/行距滑杆是每一格一次。

- 修法：draft 本地先行，`blur`/弹窗关闭/300-500ms 防抖再提交；滑杆在 `pointerup` 提交。

### C19【已确认】收件人输入框被清空后，发送仍会发往界面上看不见的推荐地址

`95-dialogs.js:3588` `const toAddress = String(toDraft || suggestedTo || '').trim();`
而发送按钮只看 `toAddress`（`4539`）。用户把「收件人」删空，界面显示空，按钮仍可用，
邮件发往 `suggestedTo`。

- 修法：`toDraft` 初始化为 `suggestedTo`（看得见才发得出去），或清空即禁用并提示。

---

## D. 低优先级 / 边界

| # | 位置 | 问题 |
| --- | --- | --- |
| D1 | `client/src/62-read.js:57-82` | `paragraphsOf` 用 `pos + line.length + 1` 推进，`\r\n` 只算 1 个字符 → 含 CRLF 的章节（外部导入/备份恢复）段落 `start` 逐行前移，批注越往后越偏。改成按实际分隔符长度推进，或导入时统一换行。 |
| D2 | `lib/library.js:378-391` | 镜像给无题章节编造「第N章」，而导出路径（`routes.js:214-224`）刻意保留无题（R14 ①）。同一本书「文件夹里的 docx」和「导出的 docx」章节标题不一致。 |
| D3 | `client/src/10-db.js:583-629`、`874-932` | 删书/删章只清 `novels/chapters/versions/marks`，`notes`/`lore`/`revisions` 留成孤儿；清空回收站后永久占库。建议删除时一并进回收站 payload 或在 `emptyTrash` 里级联清理。 |
| D4 | `client/src/50-shelf.js:755-762` + `90-app.js:2119-2144` | 搜索命中别的书的章节时连续调 `onSelectNovel` / `onSelectChapter`，两个 `selectChapter` 都读到旧的 `activeChapterId` 闭包、都能通过守卫 → 可能打开「上次读到的章」而不是点的那一章。建议串行化或用一个 `pendingSelectRef`。 |
| D5 | `client/src/60-editor.js:4790` + `2212-2242` | `onKeyUp` 无条件 `scheduleMeasure(true)`：手动滚开 800ms 后按 Shift/Ctrl/Esc 也会把视口拉回光标（`caretScrollTop('center')` 总会返回数值）。只在编辑/导航键上调度，或对 `pendingCenter` 增加来源判断。 |
| D6 | `client/src/60-editor.js:4437-4446` | 编辑器常驻的 1.5s `setInterval` 每拍走一遍祖先链 + `getComputedStyle`；隐藏标签页照跑。建议改成 `ResizeObserver` + 指数退避。 |
| D7 | `client/src/60-editor.js:2420-2434`、`4471-4476` | `focusRafRef` 与 `openFind` 里的两个 `setTimeout(0)` 聚焦定时器没有在卸载时取消。 |
| D8 | `client/src/92-advice.js:243-249`、`793` | 缓存指纹只取前 4000 字 + 总长度：长章（>4000 字）里把某个词换成等长词，指纹不变 → 「重开显示上次结果」，但引文已对不上。建议指纹覆盖全文（djb2 很快）或记录每个 quote 的定位。 |
| D9 | `client/src/30-io.js:306-313` | `exportProject` / `exportAll` 忽略 `download()` 的布尔返回：浏览器拦截下载时仍提示「导出成功」。 |
| D10 | `client/src/95-dialogs.js`（原 1356） | ~~恢复确认文案与真实行为不符（见 A2）~~ **已修**：文案改成「覆盖小说 / 章节 / 便签 / 标注 / 设定 / 已接收建议，备份里没有的部分会保留」。 |
| D11 | `client/src/90-app.js:2515-2521` | 6s 同步轮询不判断 `document.hidden`，后台标签页每 6 秒仍解密整份 `sync-state` 并比对。 |
| D12 | `lib/routes.js:786-787` | 每次自动保存都写一次 `settings.json`（`lastMirrorAt`），磁盘写放大（配合 C3 更危险）。 |
| D13 | `client/src/95-dialogs.js:52-62` | `ModalShell` 只有 `aria-modal="true"`，没有初始焦点、没有焦点陷阱、关闭后不归还焦点：Tab 会走回正文 textarea，边「盖着弹窗」边改正文。 |
| D14 | `client/src/90-app.js:4486-4536` | `ModelPicker` 自己渲染一层 `nw-modal-mask`，但没有注册 `useModalEscape`（同文件的 `ModalRequest` 在 `4436` 注册了）：按 Esc 关掉的是它下面那层投稿弹窗，选模型框留在屏幕上。 |
| D15 | `client/src/92-advice.js:1036-1052` | 全局 J/K/方向键只排除 INPUT/TEXTAREA/contentEditable，不排除 `SELECT`、按钮和 `.nw-modal-mask`：在设置里用下拉框按上下键会滚动正文、按 A/R 会在弹窗背后接受/拒绝建议。 |
| D16 | `client/src/92-advice.js:1507-1516` + `40-ui.js:212-218` | 选中改写窗口的 Esc 是独立 window 监听、不在 `escapeStack` 里，且 `stopPropagation` 拦不住同一节点上的其它监听 → 焦点不在弹窗内时一次 Esc 关两层（选中窗口 + 设置，设置的草稿一起没）。 |
| D17 | `client/src/95-dialogs.js:1929-1935`、`2376-2377` | SMTP 保存不校验 host/user/端口，空主机也提示「已保存」；「自动保存间隔」在每次按键就被 `Math.max(300, …)` clamp，想输入 600 会先变成 300 再变 3000。 |
| D18 | `client/src/95-dialogs.js:362-386` | 期刊「80000 以上」这类只有下限的区间被显示成 `80000-0`，编辑保存时又交换成 `0-80000`，开区间被折成上限。 |
| D19 | `client/src/95-dialogs.js:1394-1400` | 从备份文件恢复用 `file.text()` 整文件读入再整串发给宿主，大快照内存瞬时翻倍；建议加大小上限/分片。 |

---

## E. 性能与可优化（不改也不会坏，但值得做）

1. **导入是 O(n²)**：`importNow`（`90-app.js:3262-3266`）逐章 `createChapter`，
   而 `createChapter`（`10-db.js:714-740`）每次 `readAll('chapters')` 全表求 maxOrder。
   1000 章的 epub ≈ 50 万行反序列化 + 2000 次小说行读改写，导入会卡到分钟级。
   建议加 `createChapters(novelId, rows)` 单事务批量插入。
2. **每次自动保存 dump 全库两次**：`mirrorLibrary`（`90-app.js:1768`）与 `syncLibrary`（`1676`）
   各调一次 `NW.db.dump()`；`dump` 串行读 9 个 store（`10-db.js:1791-1818`）。
   加密开启时 `syncLibrary` 还逐章 `await decryptText`（`1731-1741`，串行）。
   建议：一次 dump 两个消费者共用；解密改成有上限的并发；`dump(stores)` 支持白名单。
3. **6s pull 每次都读 + 解密整份 mirror**：`lib/lansync.js:715-720`。建议在 `sync-state.json`
   旁边维护一个 `{etag, updatedAt}` 小文件（或把 revision 放进文件名），pull 先比 etag 再解密。
4. **每次编辑推整库**：`syncPush`（`30-io.js:1172-1173`）把全部章节正文发一遍（2s 防抖）。
   与 R78 的增量写盘思路对齐：让 `sync.push` 接受 `{books, full:false}`，只推变过的书
   （宿主 merge 本就按书级 LWW）。
5. **长章每键全量统计**：`emitSelection`（`60-editor.js:1813-1857`）每键跑 `wordCount`（逐字符 + 3 个正则，
   `20-format.js:81-114`）和 `lineColOf`（先 `slice` 整章再逐字符数换行）。20 万字章 ≈ 60 万次正则/键。
   建议字数按增量维护（记录上次长度与差分），行列号挪到 100ms 节流通道。
6. **高亮每帧全量重建**：`60-editor.js:2496` → `rebuildHighlights()`（`1918-1938`）
   每次测量都 `clearNode` + 重建所有 `<mark>`。只在 marks/find 变化时重建。
7. **`listChapters` 串行 hydrate**（`10-db.js:675-688`）：每次改名/新建/删除都要逐章解密一遍；
   `Promise.all` + 并发上限即可（注意别把顺序打乱，`orderChapters` 之后再并列）。
8. **新增一本书仍会整库重写**：`90-app.js:1881` `if (next.size !== seen.size) changed = null;`
   宿主本来就会用 `plannedNames(previous)` 对比清理旧文件，书数变化时其实只需把新书加进 `changed`。
   现在「加一本书」等于把一百个 `.docx` 全部重写一遍，正好是 R78 想避免的。
9. **客户端 `api()` 无超时**（`30-io.js:43-75`）：宿主卡住时按钮永远转圈。加 `AbortSignal.timeout`。
10. **`verify-docs.mjs` 用管道 stdio 起 python**（`766`）：在受限沙箱里必然 `spawn EPERM`。
    按 `build-apk.mjs` 的经验改 `stdio: 'inherit'`，或检测不可用时 skip 并标明。

---

## F. 文档与测试

- ~~`README.md:113` 的安装示例还是 `"version":"1.3.0"`~~ **已修**：改成 1.6.1 并随本轮版本号一起更新。
- 已知限制第 14 条「R3 起的改动均没有跑自动化测试」早已过时（现在有 246 + 42 + 14 项）；
  同一份文档里第 44 条又写了 246 项，前后矛盾。
- 已知限制没有覆盖 A1（未设密码时同步不推）、A2（文件夹恢复清五类数据）、
  B1/B2（TLS 降级与 STARTTLS 剥离）——这四条都是「用户会踩且猜不到」的。
- `verify-dialog-kinds.mjs` 报告 `Lock` / `Versions` 两个弹窗注册但无人调用；
  如果它们已被 R35/R77 的入口替代，应删掉死代码，避免以后误以为还能打开。
- 缺少针对 `90-app.js` 的组件级测试（R78 已把修改建议拆出去并测了 42 项，可照此把
  「自动保存 / 恢复 / 同步」三条链路抽出来，用现有的极小 React 替身测）。

---

## G. 建议的修复顺序

| 顺序 | 项 | 理由 |
| --- | --- | --- |
| 1 | ~~A1 一行修复 + A3 抛错~~ **已完成** | 极低成本，直接解除「同步失效 / 假已保存」两种静默故障 |
| 2 | ~~A2 快照补字段 + 合并式恢复 + 文案~~ **已完成** | 唯一一条「恢复反而毁数据」的路径 |
| 3 | ~~B1/B2 TLS 策略~~ **已完成（R80）** | 涉及用户邮箱授权码，改起来只动 `smtp.js`/`imap.js` 的 30 行 |
| 4 | B3 Origin/Content-Type 校验 | 宿主单点，改动小，收益大 |
| 5 | C1 原子写 + 锁、C3 settings 队列 | 都是照着 `writeSettingsAtomic`/`secrets.enqueue` 抄，风险低 |
| 6 | C2 签名补 notes/submissions、C5 取消、C6 单飞 | 功能正确性 + 花钱的问题 |
| 7 | C15 设置不再自动开放局域网、C16 导出目标、C17 设定集重复、C12/C13 建议状态 | 都是用户一用就能撞到的「行为不对」，改动集中在弹窗层 |
| 8 | C4/C7/C8/C9/C10/C14/C18/C19 | 并发、边界与键盘可达性，逐个配回归测试 |
| 9 | D/E 列表 | 按用户实际抱怨排序，别一次全动 |

---

## G2. R81 修复登记（本轮落地）

| 条目 | 落地方式 |
| --- | --- |
| B3 跨站守卫 | `createHandler` 要求 `application/json` + Origin/Host 同源校验；`[8f]` 4 项钉住。 |
| C1 镜像原子写/串行 | `writeBytesFile` 临时文件 + rename；`mirrorLibrary` 单一队列。 |
| C3 settings 读改写 | `writeSettings` 串行队列，五个调用方不再互相覆盖。 |
| C7 ZIP 炸弹 | `inflateRawSync` 256MB 输出上限，坏 zip 报「解压失败或超过上限」。 |
| C6 单飞闸门 | `aiBusy` 在 try/finally 内设置，`writeHead` 失败不再永久 429。 |
| C8 身份 / peers 竞态 | `deviceIdentity` 单飞；`peers.json` 读改写统一队列。 |
| C5 AI 取消/超时 | 客户端 60s（AI 10min）超时 + 流式 `AbortController`；宿主 `res.on('close')` → `llm.stream` signal。 |
| C4 章节整行竞态 | `updateChapter` / `saveChapterContent` 接入章节队列。 |
| C9 onMarksShift | 编辑器把 `chapterId` 随 diff 传回，父组件不再读当前章。 |
| C10 批注 pending | pending 时保持 dirty；建行成功后补写最新一句；关闭时保留在飞对象等 id 落地。 |
| C2 签名漏便签/投稿 | `autosaveSignature` 纳入 notes/submissions，纯 meta 变化时只重写快照。 |
| C11 e2e 脚本 | 删除云备份死代码、改 `.docx` 断言、保存目录一段改为显式 opt-in 并 `finally` 恢复。 |
| E7 导入 O(n²) | 新增 `createChapters` 单事务批量建章，导入不再逐章全表扫描。 |
| D1 CRLF 偏移 | 段落推进按真实分隔符长度（`\r\n` 记 2）。 |
| D11 隐藏页轮询 | `visibilityState === 'hidden'` 时跳过同步轮询。 |
| B3 目录限制（R82） | `library.mirror` 拒绝与设置不一致的 `dir`。 |
| D2 镜像章名（R82） | 无题章节不再打印「第N章」，与导出统一。 |
| D3 删除孤儿（R82） | 便签 / 设定集 / 已接收建议随书/章进回收站并可在撤销时还原。 |
| D4 打开竞态（R82） | `selectChapter` 加序号，后点者胜。 |
| D5–D9（R82） | keyup 只对编辑键重排；隐藏页跳过 1.5s 轮询并取消聚焦 rAF；建议指纹全文；导出下载失败报错。 |
| D14/D15/D16（R82） | 模型选择器与选中改写并入 Esc 栈；J/K/A/R 忽略 SELECT / 按钮 / 弹窗。 |
| D17–D19（R82） | SMTP/IMAP 保存前校验；自动保存间隔可输入；开区间显示「N 字以上」；备份文件 32MB 上限。 |
| E10 新增书重写（R82） | 新增书只写它自己；删除仍由宿主旧文件对比清理。 |

---

## H. 核对过、判定「不是问题」的点（避免下一轮重复排查）

- 宿主合并规则（书级 LWW、墓碑、同毫秒平手、密文让位于可读副本）与 `withStateLock` 串行化：
  实现正确，`verify-host` 的 9 项合并用例覆盖到位。
- `secrets.js`：key.bin 单飞创建、短密钥保留证据并另存、store 原子写、写入串行队列——没有发现缺口。
- 流式 NDJSON 的分块边界（`30-io.js:1098-1118`）：`TextDecoder({stream:true})` + 按 `\n` 切行 +
  末尾 `handleLine(buffer)` 冲最后半行，不会把半行 JSON 当事件。
- `download()`（`30-io.js:260-281`）：objectURL 4 秒后 `revokeObjectURL`，没有泄漏。
- 主题跟随系统（`90-app.js:1097-1112`）：`matchMedia` 监听有对称移除；`97-theme.js` 只有 CSS。
- 弹窗叠加（除 D14/D16 两个例外）：`ModalRequest` 与 `ModalShell` 都注册了 `escapeStack`，
  「一次 Esc 只关一层」在它们之间成立。
- 编辑器切章：`NW.Editor` 以 `chapter.id` 为 key，`onSave` 闭包自带 `chapter.id`，
  正文不会写到别的章（`onMarksShift` 是例外，见 C9）。
- 读后感页的 pointer/scroll/resize/RO/rAF/翻页定时器都有对称清理；
  页边签点击有委托处理，不存在「点了没反应」。
- 导入分章正则 `CHAPTER_TITLE_RE` 没有灾难性回溯；Markdown 清理是有序的字面替换。
- `zip.js` 的读路径除「解压无上限」（C7）外，边界检查（越界、zip64、签名、大小不符）齐全。
- `qr.js` 的 SVG 只拼接矩阵矩形，不插值用户字符串，`dangerouslySetInnerHTML` 的点是安全的。

---

## I. 本次审计的已知盲区

- 没有真实浏览器，编辑器 DOM/IME/气泡的时序问题只能靠代码推断（标「需复现」）。
- 没有真机，Android 侧只抽查了 `LanClient` 的签名与清单的 cleartext 配置。
- 没有对真实 SMTP/IMAP 服务器发起连接，TLS 结论来自代码路径。
- 用户数据（`sync-state.json`）只读取了元数据（书目数量/字数/时间戳），没有输出正文。
- 未对 90-app.js / 95-dialogs.js 的每个分支做穷举，只围绕「保存、恢复、同步、导出、建议、配对」
  六条主链路追调用链。

---

## J. 附录：最小补丁（前六项，可直接照抄）

```diff
--- client/src/90-app.js  (A1)
-        if (NW.crypto.hasPassword && NW.crypto.hasPassword() && !NW.crypto.isUnlocked()) return null;
+        const hasPw = NW.crypto && typeof NW.crypto.hasPassword === 'function'
+          ? await NW.crypto.hasPassword()
+          : false;
+        if (hasPw && !NW.crypto.isUnlocked()) return null;
```

```diff
--- client/src/10-db.js  (A3：只改正文这一条最要命的路径，避免动 40 个调用点)
     const ok = await writeBatch([{ store: 'chapters', type: 'put', value: next }]);
-    if (!ok) return;
+    if (!ok) throw new Error('保存正文失败：IndexedDB 写入未完成');
     if (next.novelId) await touchNovel(next.novelId);
```

```diff
--- lib/lansync-server.js  (C6)
     const streaming = opened.json.stream === true;
-    if (streaming) {
-      res.writeHead(200, { ... });
-    }
     // ...
     try {
+      if (streaming) {
+        res.writeHead(200, { ... });
+      }
       const common = { ... };
```

```diff
--- lib/zip.js  (C7)
-          data = inflateRawSync(raw);
+          data = inflateRawSync(raw, {
+            maxOutputLength: Math.min(Math.max(usize, 1), 256 * 1024 * 1024),
+          });
```

```diff
--- client/src/95-dialogs.js  (C16 第一步：别再丢掉请求里的书 id)
-    const hasChapter = !!(defaultTarget.kind === 'chapter' && defaultTarget.id);
-    const target = hasChapter ? defaultTarget : { kind: 'novel', id: String(novel.id || ''), title: novelTitle };
+    const target = defaultTarget.id
+      ? defaultTarget
+      : chapter
+        ? { kind: 'chapter', id: String(chapter.id || ''), title: String(chapter.title || '') }
+        : { kind: 'novel', id: String(novel.id || ''), title: novelTitle };
```

> C16 还有第二步：`90-app.js:3151-3164` 的 `exportNow` 目前固定用 `activeNovelId`，
> 需要按 `opts.target.kind === 'novel'` 去 `novels` 里取对应书、再用它的 id 调 `NW.db.listChapters`。
> C15 没有一行补丁：把 `h(PairPanel, …)` 外面套一层 `tab === 'lan' ? … : null`，
> 并在设置关闭时调 `NW.io.pair.cancel()`。

```diff
--- lib/routes.js  (B3：createHandler 入口，先看 Origin 再解析 body)
     const verb = String((req && req.method) || 'GET').toUpperCase();
+    const origin = String((req && req.headers && req.headers.origin) || '');
+    const host = String((req && req.headers && req.headers.host) || '');
+    if (origin && verb !== 'GET' && verb !== 'HEAD') {
+      let sameOrigin = false;
+      try { sameOrigin = new URL(origin).host === host; } catch { sameOrigin = false; }
+      if (!sameOrigin) {
+        sendJson(res, { ok: false, error: { code: 'forbidden-origin', message: '跨站请求已拒绝' } });
+        return;
+      }
+    }
```

> 说明：A3 的补丁只让「正文保存」把失败抛出来；`writeBatch` 全局改成 throw 会牵动约 40 个调用点，
> 建议下一轮统一改成返回 `{ok, error}`，再逐个调用点处理。
> B3 的补丁是 O(1) 的起源校验，不动现有鉴权；要更严可再加 `Sec-Fetch-Site: same-origin` 和一次性 nonce。

