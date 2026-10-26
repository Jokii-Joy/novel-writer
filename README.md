# 精神空间 · Mindspace

DeepSeek Harness 里的一体化小说写作插件：章节树、沉浸写作、AI 校对与一键排版、
导入导出（txt / md / docx / epub / pdf）、投稿向导与期刊库、收件箱、加密本地存档，
外加一个 Android 手机端，在同一个 Wi-Fi 下与桌面双向同步。

![书架与编辑器](docs/screenshots/final-01-canvas.png)

## 功能

- **写作**：可折叠章节树、沉浸模式、打字机模式、粗光标、九套阅读主题、白天/黑夜；
  章节标题在稿纸上点一下就能改，首页「正在创作」直接标出正在写哪一章。
- **AI**：AI 校对逐条给出修改建议；一键排版；模型选择与自动回退。
- **稿件**：导入 txt / md / docx / epub 自动分章；导出 txt / md / docx / epub / pdf。
- **投稿**：三步投稿向导，内置 79 家文学期刊库（可增删改），按体裁/字数/风格推荐；
  投稿记录跟着书走，改名后显示「现名（投稿时：旧名）」。
- **邮件**：SMTP 发信、IMAP 收件箱，直接在插件里读投稿回信。
- **存档**：本地 IndexedDB + 可选加密（PBKDF2 + AES-256-GCM），版本历史与回收站；
  保存到文件夹时书名改动会覆盖旧文件，不会越攒越多。
- **手机**：Android App 与桌面局域网同步（配对码 / 扫码），断网改动合并时不丢书。

## 安装

插件包目录即仓库根。在 DSH 里执行：

```
plugin_manager action=install_bundle target=<本仓库绝对路径>
```

安装后左侧栏出现书本图标，点击进入「精神空间」主面板。校验 Host 是否就绪
（`dsh web` 的端口每次启动都会变）：

```bash
curl http://127.0.0.1:<web端口>/novel-writer/api/ping
# {"ok":true,"data":{"name":"novel-writer","version":"1.2.0",...}}
```

改 Host 代码后要**重载插件**（Node 模块已缓存）：

```
plugin_manager action=set_plugin target=include:novel-writer enabled=false
plugin_manager action=set_plugin target=include:novel-writer enabled=true
```

只改客户端则重建产物，刷新页面即可：

```bash
node scripts/build-client.mjs    # client/src/*.js → client/client.js（含加载闸门）
```

## 手机端

APK 在 [`dist/精神空间.apk`](dist/精神空间.apk)（约 0.54 MB，Android 7.0+，无需 Gradle 构建）。
源码在 `app/`，用 `node tools/build-apk.mjs` 重新打包。

配对：桌面「设置 → 手机同步」生成地址与配对码 → 手机「配对」里手填（扫码为备选）。
同步走局域网 HTTP，端口 41288，UDP 41287 发现（双向：桌面每 10 秒广播一次，手机也发
`role:'probe'` 探针、桌面立刻单播应答，所以点一次「立即同步」就能找到电脑，不必反复按）。
正文在手机上以明文存放，桌面侧的同步缓存仍用本机密钥加密。

## 开发

```bash
node scripts/verify-host.mjs     # 离线宿主测试（不需要运行中的 DSH）
node scripts/verify-docs.mjs     # 导入导出与 docx/epub 排版断言
node tools/build-apk.mjs         # 重打 APK（工具链在 .tools/android/）
bash tools/build-apk.sh          # 同一套五步的 bash 版（Node 的管道 spawn 被沙箱拒时用）
```

- 运行时零第三方依赖：Host 只用 Node 内置模块，Client 只用宿主提供的 `react` 与主题 token。
- 入口：`index.js`（Host）+ `client/client.js`（浏览器，由 `client/src/*.js` 按文件名拼接）。
- 接口：`/novel-writer/api/*`，统一 `{ok, data|error}`，方法表见 `docs/CONTRACT.md`。
- 目录说明与逐轮改动记录见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

## 提交与发布

每次 `git commit` 后自动上传到 GitHub（`.githooks/post-commit` → `tools/auto-push.mjs`），
失败会重试并记在 `.tools/push.log`。配置见 `docs/CHANGELOG.md` 的「上传到 GitHub」一节。

## 许可

Copyright (C) 2025 Jokii-Joy

本项目以 **GNU General Public License v3.0 or later** 发布，全文见 [LICENSE](LICENSE)。
你可以自由使用、修改和分发；分发修改后的版本时须同样以 GPL-3.0-or-later 开放源代码，
并保留版权声明。本程序不提供任何担保。
