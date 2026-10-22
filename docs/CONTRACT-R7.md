# novel-writer R7 契约增量

本文件只记录 R7 改动过的对外行为（wire 契约 + 用户可见行为）。R3 / R5 的契约仍然有效，见 `docs/CONTRACT-R3.md`、`docs/CONTRACT-R5.md`。

R7 的四项需求分别是：① SMTP 邮箱连不上排查 ② 期刊分体裁 / 分篇幅的投稿邮箱 ③ 严格按期刊投稿要求生成邮件 ④ 更多云备份方式。

---

## 1. SMTP：为什么连不上，现在怎么报

### 1.1 四个真实缺陷（已修）

| 缺陷 | 现象 | 修法 |
| --- | --- | --- |
| 证书校验没有回退 | 公司网络 / 杀毒软件会做 TLS 中间人，`UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`SELF_SIGNED_CERT_IN_CHAIN` 一出现，465 端口**永远连不上**，而提示却是「改用 587」——方向完全错 | `openSocket()` 在证书类错误时自动用 `rejectUnauthorized:false` 重试一次，并在回执里带 `certBypassed:true`，界面明确告知「证书校验已自动跳过（多为公司网络/杀毒软件的中间人代理）」 |
| 错误码被吞 | 所有 TLS 失败都变成同一句「TLS 握手失败」，DNS 解析失败 / 端口被防火墙挡 / 域名写错长得一模一样 | `classifySocketError()` 按 `error.code` 分出 `smtp-dns-failed` / `smtp-port-closed` / `smtp-unreachable` / `smtp-timeout` / `smtp-cert-failed` / `smtp-connect-failed` |
| `secure` 缺省相反 | 设置页写的是「非 465 即明文」，`normalizeConfig` 写的是「非显式 true 即明文」——手填 587 会朝明文端口发 TLS，手填 465 反而发明文 | `secure = source.secure === undefined ? port === 465 : source.secure === true`（两处一致由端口推断） |
| 诊断只回最后一条错误 | 三个端口试完，用户只看到 25 端口的结果，自己配的 465 为什么失败反而看不到 | `diagnose()` 返回 `primary` = 用户真实配置那一档，另有 `alternative` = 备选；`attempts[]` 逐档带 `code`/`detail` |

### 1.2 新增 / 变更的 wire 字段

`submit.smtpTest`（`lib/routes.js` 的 `handleSmtpTest` → `lib/smtp.js` 的 `diagnose`）回执：

```jsonc
{
  "ok": true,
  "detail": "已连接 smtp.qq.com:465（SSL/TLS），登录成功",
  "primary": { "label": "SSL 465", "ok": true, "code": "", "detail": "…" },
  "alternative": { "label": "STARTTLS 587", "ok": false, "code": "smtp-port-closed", "detail": "…" },
  "attempts": [
    { "label": "SSL 465", "host": "smtp.qq.com", "port": 465, "secure": true, "ok": true,
      "code": "", "detail": "…", "certBypassed": true, "hint": "" }
  ]
}
```

`hintFor()` 新增四条码的翻译：`smtp-dns-failed`、`smtp-port-closed`、`smtp-unreachable`、`smtp-cert-failed`。

### 1.3 用户可见行为

- 设置 → 邮件服务器 → 测试连接：失败时依次显示「一句话原因」「下一步怎么做」「三个端口的逐档结论」。客户端用 `ATTEMPT_REASON` + `attemptsLine()` 渲染，不再只有一行红字。
- 证书被跳过时，界面会写明这是**代理/杀毒软件**造成的，不是邮箱服务器坏了。

---

## 2. 期刊库：分体裁、分篇幅的投稿邮箱

一本刊可能「短篇投这个邮箱、长篇投那个邮箱」。数据结构从单一 `email` 扩展为 `emails[]`：

```jsonc
{
  "email": "通用邮箱@example.com",        // 仍然保留，兜底用
  "emails": [
    { "email": "duanpian@example.com",
      "genres": { "duanpian": true, "zhongpian": true },   // 空对象 = 不限体裁
      "band": "short",                                    // short | medium | long，或 ""
      "minWords": 5000, "maxWords": 30000,                // 0 = 不限
      "note": "只收现实题材" }
  ]
}
```

- 篇幅档位（`LENGTH_BANDS`）：短篇 ≤ 10000 字、中篇 ≤ 30000 字、长篇更大。
- 匹配规则：**声明出来的条件都是硬条件**。体裁要对得上，字数要落进区间，`band` 要对得上——只要一条不符就换下一个候选。分体裁邮箱的优先级高于通用 `email`。
- `journals.email {journalId, genre, wordCount}` → `{journal, resolved}`，`resolved` = `{email, note, band, bandLabel, matched:'variant'|'default'|'none', variants}`。
- 投稿向导会**自动按当前稿件**的体裁与字数选中正确邮箱，并在第 ②③ 步显示「为什么用这个邮箱」。

### 2.1 批量导入（新增）

`journals.importEmails {text, dryRun}` → `{updated, added, unmatched[], skipped[], journals[]}`。

每行一家，格式：

```
期刊名 | 邮箱 | 体裁 | 字数 | 备注
钟山 | zhongs@example.com | 短篇,中篇 | 5000-30000 | 只收现实题材
钟山 | zscp@example.com | 长篇 | 80000以上
```

后三列可省——省了就是这家刊的通用邮箱；填了体裁或字数就记成分列邮箱。`dryRun:true` 只回报告不落盘。期刊名支持别名与包含匹配，匹配不上的会列在 `unmatched` 里。

入口：期刊库对话框 → 工具栏「批量导入邮箱」。

> 为什么是「导入」而不是内置全量清单：内置的 79 家里有 21 家查不到可核实的公开邮箱，联网检索在本机不可用，**不能凭空编地址**。所以把「粘贴官网征稿启事」做成一条一步就能走完的路。

---

## 3. 邮件正文：严格按期刊要求来

新增 `submissionRules(journal)` → `{pasteInBody, formats[], reasons[], requirements[]}`。

判定只看**征稿要求文本**，不看我们的偏好：

| 要求里出现 | 结论 |
| --- | --- |
| 「正文粘贴」「全文贴在邮件」「不要附件」「勿附件」等（`PASTE_HINTS`） | `pasteInBody:true`，小说全文进正文 |
| 「只收 Word」「docx」「不要 PDF」「谢绝 PDF」等（`DOCX_ONLY_HINTS`） | `formats:['docx']`，附件只有 Word |
| 「附件」+ 明确列出格式（`ANY_FORMAT_HINTS`） | 按刊列出的格式 |
| 什么都没写 | 默认只 `docx`（PDF 没有构建器，一律过滤掉） |

`reasons[]` 会把「为什么这样决定」回传，界面第 ③ 步显示成「照刊要求：…」一行。

`submit.prepare` 回执新增：

- `pasteInBody: boolean` — 正文里是否已经粘了全文
- `attachFormats: string[]` — 这次要附的文件格式
- `ruleNotes: string[]` — 判定理由

正文由 `manuscriptText(work)` 生成（章节正文顺序拼接）。附件由 `buildSubmissionAttachments(journal, novel, genre, wordCount, formats)` 生成，**`formats` 传空数组是合法的**（表示该刊不要附件）。

用户会在第 ③ 步看到：

- 附件区空着时提示「该刊不要求附件，全文已粘贴在正文」；
- 「正文」行显示「已粘贴全文（N 字）」或「只有投稿信」。

---

## 4. 云备份：新增「网盘同步文件夹」后端

现在三种后端，`status().providers = ['webdav','gist','folder']`，`resolveKind()` 优先级 webdav > gist > folder。

### 4.1 为什么加 folder

- WebDAV：国内大多数网盘根本不支持，坚果云还要单独开应用密码；
- GitHub Gist：免费但单文件只有 **900KB** 上限，长篇备份会被截断；
- **folder**：指向你已经装好的网盘客户端（OneDrive / 坚果云 / 百度网盘 / iCloud 驱动器）的同步目录，插件只写本地文件，上传交给网盘客户端。零 API、零配额配置、断网也能备份。

### 4.2 行为

- `cloud.config {kind:'folder', fields:{dir}}` → 校验非空、≤400 字符。
- `cloud.login` → 创建目录（不存在则递归建）→ 列出现有备份 → `{state:'ok', kind:'folder', account:<目录>, dir, items:<数量>}`。
- `cloud.list/upload/download` 全部支持，`id` 是文件名。
- 只识别文件名以 `novel-writer` 开头的 `.json`，最多保留最近 **20** 份（`FOLDER_KEEP`）。
- 失败码翻译：`ENOENT`/`EACCES`/`EPERM`/`EEXIST`/`EROFS` 会给出「路径是否存在、有没有写权限、是不是只读网盘」的具体建议。

---

## 5. 兼容性与遗留

- `aliyun` 相关 wire 码保留（历史凭据会静默降级，`status().legacyAliyun` 上报），但界面不再提供阿里云。
- `cloud.poll` 恒返回 `cloud-no-poll`（三种后端都不需要扫码轮询）。
- 内置期刊仍然全部 `verified:false`——邮箱必须用户自己核对，界面把「待核对 / 已核对」做成显式徽标。
- 本版本只做 `node --check` + 构建，端到端流程由用户自测（见 README §3）。
