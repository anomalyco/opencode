# Office 文档预览（已实现）

## 目标

让 OpenCode 直接预览 `.doc / .docx / .xls / .xlsx / .ppt / .pptx`（含 .rtf / .odt / .ods / .odp）等 office 文档，要求：

- 保留版式 / 图片 / 样式（可接受小幅度偏差）
- 文字可选可复制可搜索
- 新老格式都适用
- 体验统一（所有 office 用同一个查看器）
- 完全开源依赖（OSI 协议）
- 不依赖任何付费组件 / license key

## 总体架构

**统一管线：所有 office 文件 → LibreOffice 转 PDF → pdfjs（带 text layer）渲染**

```
 ┌─────────┐    ┌──────────────────┐   ┌──────────┐
 │ .pptx   │ →  │ 后端              │ → │ 前端      │
 │ .docx   │    │ libreoffice.ts   │   │ pdfjs   │
 │ .xlsx   │    │  (soffice 子进程) │   │ + text  │
 │ .pdf    │    │  + (path,mtime) │   │ layer   │
 │ ...     │    │   磁盘缓存       │   │ 懒加载   │
 └─────────┘    └──────────────────┘   └──────────┘
```

PDF 文件本身不经过转换，直接给 pdfjs。

## 依赖（全部 OSI 开源）

| 库 | 协议 | 用途 |
|---|---|---|
| `pdfjs-dist` | Apache-2.0 | PDF 渲染（Mozilla 维护，行业标准） |
| LibreOffice | MPL 2.0 | office 转 PDF 的引擎（按需下载到本机） |

**不再用**：docx-preview、exceljs、Univer、PptxViewJS 等浏览器端库——已全部移除。

## 后端

### `packages/opencode/src/file/index.ts`

`read()` 对扩展名分类：

- **officeDirect**：`pdf` — 直接 base64 inline 返回
- **officeConvert**：`doc / docx / xls / xlsx / ppt / pptx / rtf / odt / ods / odp` — 调 LibreOffice 转 PDF，然后返回 marker `{type: "text", content: "", encoding: "office-pdf-ref", mimeType: "application/pdf"}`，**不**把 PDF 字节通过 base64 + JSON 传输（避免大文件 OOM）

`Content` 协议扩展：`encoding` 加 `"office-pdf-ref"` 枚举值。

### `packages/opencode/src/file/libreoffice.ts`

- `convertToPdf(filePath)` — 调 `soffice --headless --convert-to pdf`
- 按 `(path, mtimeMs, size)` SHA256 哈希缓存到 `Global.Path.cache/office-pdf-cache/<hash>.pdf`，跨重启复用
- soffice 路径解析优先级：`OPENCODE_SOFFICE` 环境变量 → 持久化路径（installer 写入）→ PATH → Windows 常见安装位置

### `packages/opencode/src/file/office-installer.ts`

按需下载 + 静默安装 LibreOffice。

- 多镜像测速：清华 / 中科大 / 北外 / 南大 / TDF 官方，`Promise.any` 并发 HEAD 探测，最快胜出（国内用户实测 < 100ms 命中国内镜像，TDF 官方 ~3s）
- 下载 `LibreOffice_<ver>_Win_x86-64.msi`（约 355MB），走 `fetch` + `ReadableStream` 边下载边写盘 + 实时进度（速度 / 剩余）
- 缓存复用：MSI 已存在（>100MB）则跳过下载
- 静默安装：`msiexec /i ... /qn ALLUSERS=2 MSIINSTALLPERUSER=1 REBOOT=ReallySuppress /norestart`，per-user 安装到 `%LocalAppData%\Programs\LibreOffice\`，**不弹 UAC**
- 安装失败时（`msiexec /l*v` 详细日志）—— 识别 `MsiSystemRebootPending=1`（PendingReboot）状态给用户明确指引
- 安装路径写入 `Global.Path.state/office-tooling.json` 持久化

### HTTP 路由（`packages/opencode/src/server/routes/instance/file.ts`）

- `GET /file/office-pdf?path=<rel>` — 直接返回二进制 PDF（`application/pdf`），用于大文件传输（避免 base64 + JSON 的内存爆炸）
- `GET /office-tooling/status` — 返回 LibreOffice 是否可用、安装进度
- `POST /office-tooling/install` — 启动后台安装任务
- `GET /office-tooling/progress` — 轮询安装进度

## 前端

### 渲染组件 `packages/ui/src/components/document-viewer/`

- `index.tsx` — `DocumentViewer` 入口，Suspense + lazy load PdfViewer
- `pdf.tsx` — `PdfViewer`：
  - **二进制源切换**：内联 base64（`.pdf` 文件）走 `arrayBufferFromMediaValue`；office-pdf-ref 走调用方传入的 `loadBinary()` 函数
  - **传给 pdfjs 前 `bytes.slice()`** 复制一份（pdfjs 默认 transfer 输入 buffer，会 detach 原 buffer，缓存场景必须复制）
  - **自适应缩放**：探测页 1 原始宽度，按容器 `clientWidth - 72px` 算 fit scale，clamp 在 `[0.6, 1.5]`，避免宽屏 PPT 撑出滚动区
  - **懒加载分页**：所有页先创建轻量占位 div（"第 N 页"文字），用 `IntersectionObserver` 监测，进入视口附近 800px 才真正调 `page.render()` 画 canvas + textLayer。300+ 页大文件内存与可视区页数线性而非总页数线性
  - **Text Layer**：`pdfjs.TextLayer` 渲染透明 text `<span>` 叠在 canvas 上，鼠标拖选可复制可搜索

### `packages/ui/src/components/office-install-prompt.tsx`

LibreOffice 未安装时的 onboarding UI：

- 主按钮："⬇ 下载预览插件（约 355 MB）"，hover/active 反馈用 `<style>` 内嵌 CSS
- 次按钮："改用本机 Office 软件打开"，调 Tauri `open_path` 调起系统默认应用
- 状态机：`probing → downloading（含速度+镜像名+进度条）→ installing → done`
- 失败状态显示具体 MSI 日志路径
- 安装完成后显示"重新加载文件"按钮

### `packages/ui/src/components/file-media.tsx`

- `mediaKindFromPath()` 把所有 office 扩展名映射到 `"pdf"` kind
- `kind === "pdf"` 分支：
  - 检测到 `encoding === "office-pdf-ref"` → 走 DocumentViewer + loadBinary
  - 检测到 binary（LibreOffice 没装）→ 显示 OfficeInstallPrompt
  - 其他（直接 base64 PDF）→ 走 DocumentViewer

### App 层接线 `packages/app/src/pages/session/file-tabs.tsx`

提供给 `FileMedia` 几个回调：

- `loadOfficePdf(path)` — 调 `sdk.client.file.officePdf({path}, {parseAs: "arrayBuffer"})`，**带 LRU(2) 内存缓存**（key = `directory::path`），切换 tab 后再切回大 PPT 直接秒开
- `onOpenExternal()` — 调 Tauri `open_path` invoke
- `onRetryFile()` — 调 `file.load(path, {force: true})` 重新加载
- `officeTooling: { getStatus, startInstall, getProgress }` — onboarding API 包装

### 编辑禁用（`packages/app/src/utils/file-limits.ts` + `file-tabs.tsx`）

`isOfficeDocument(path)` 判断 office 扩展名 → `canEdit()` 返 false → 右键菜单"编辑"按钮 disabled，hover 提示 "Office 文件暂不支持在 OpenCode 内编辑，请用本机软件打开"。

## 长期依赖风险

| 组件 | 风险 | 缓解 |
|---|---|---|
| `pdfjs-dist` | 几乎为零 | Mozilla / Firefox 内置 |
| LibreOffice | 几乎为零 | 35 年历史 / 非营利基金会维护 / 亿级用户 |
| 国内镜像 URL | 镜像可能下线 | 5 个镜像并发竞速，任一可用即可；TDF 官方为兜底 |

## 已知约束

- **不支持 WYSIWYG 编辑** —— PDF 是只读栅格化输出。编辑路径有二:
  - **外部软件编辑**:"用本机软件打开"按钮调外部应用(Word / LibreOffice / WPS)
  - **AI agent 编辑**(2026-05-24 决策):通过「office 选中加聊天」feat 提供——user 选中 PDF 预览里的文字 → 加到聊天窗口 → 让 AI 用 python-docx / openpyxl / python-pptx 改原文件 → 重走 office→PDF 管线预览。**这条通道在产品语义上吃掉了"office 编辑"这一用户需求**,WYSIWYG 编辑器因此不重启。详见 [`OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md`](../../OPENCODE-PLAN/需求池/office-选中加聊天-架构调研.md) §1.4
- **首次打开 office 文件需 1-3 秒**（LibreOffice 进程冷启动），之后通过磁盘缓存秒开。
- **每个 office 文件首次打开**仍要冷启动 soffice，跨文件不复用进程（需要 UNO bridge 才能复用，工程量较大未做）。
- **大 PPT 内存**：~300MB PDF 在 WebView2 内存峰值约 600-700MB（`fetch` ArrayBuffer 一份 + pdfjs 内部一份），仍在可控范围。

## 用户使用流程

1. 第一次打开任何 office 文件 → 显示 onboarding 卡片
2. 点击 "下载预览插件" → 测速选最快镜像 → 下载（355MB）→ 静默安装（30-60 秒）
3. 完成 → 点 "重新加载文件" → 看到预览
4. 之后所有 office 文件直接预览，不再弹 onboarding

## 开发验证

`packages/desktop/src-tauri/target/release/OpenCode.exe` 是开发验证入口。改动后流程：

1. `cd packages/opencode && bun run build --single` （后端 sidecar）
2. `cp dist/opencode-windows-x64/bin/opencode.exe ../desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe`
3. `cd packages/desktop && bun tauri build`
4. 启动新 exe 验证

只改前端时跳过 step 1-2，直接 step 3。
