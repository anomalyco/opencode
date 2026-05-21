---
feat-id: large-file-preview-guard
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# large-file-preview-guard — 1-spec

> 大文件预览统一防护(REQ-025,2026-05-21 入池 / 实施 / 落地)

## 需求来源

User 2026-05-21 实测报告:

> 当我们点击比较大的视频文件的时候,就会把整个软件导致崩溃。

排查发现**多 viewer 通病**:视频/音频/图片/纯文本/Markdown 都是"全文件读入 JS 内存"模式,500MB-1GB 区间 WebView 必崩。需求池文档 `OPENCODE-PLAN/需求池/大文件预览统一防护.md` 上升为产品级稳定性 + 数据安全需求(软件崩溃 = 当前未保存编辑全丢)。

## 风险全景

8 条预览路径,4 条高风险:

| 文件类型 | 原实现 | 大文件风险 |
|---|---|---|
| 视频/音频 | `invoke('read_binary_file_base64')` → base64 → `URL.createObjectURL` | 🔴 高 |
| 图片(png/jpg/etc) | 后端 file.read → base64 → fileComponent(实际显示"图片不可预览") | 🔴 高 + UX 缺位 |
| 纯文本/代码 | `sdk.client.file.read()` 一次性全量 | 🔴 高(仅 10MB 禁编辑,预览仍渲染整 DOM) |
| Markdown | source 一次性传 remark/marked,AST 爆炸 | 🔴 高 |
| HTML | iframe + `localasset://`(HTTP Range)+ 10MB 闸门 | 🟢 低(参考实现)|
| 二进制 | 后端返空 content,前端虚拟分片 viewer | 🟢 低 |
| Office | LibreOffice 转 PDF → cache LRU max 2 | 🟡 中 |
| 总入口 load() | `sdk.client.file.read()` 透传,**完全无 pre-check** | 🔴 关键缺位 |

## 验收标准(P-级 happy path)

| ID | 场景 | 期望 |
|---|---|---|
| A1 | 小 .md / .ts / .txt | 正常显示,无回归 |
| A2 | 小视频(.mp4 等) | 播放 + seek + 内存恒定 |
| A3 | 小图片(.png / .jpg / .svg 等) | 显示图片(原"图片不可预览"修复)|
| A4 | 100MB+ .txt / .json | 显示 FileTooLarge 卡 + 2 按钮 |
| A5 | tooLarge 文件尝试编辑 | 编辑禁用 + "文件过大,编辑已禁用" |
| A6 | 大视频(几百 MB) | 秒开 + seek 流畅 + 内存稳 |
| A7 | tooLarge 卡 → "用本机软件打开" | 系统默认 app 打开 |
| A8 | tooLarge 卡 → "打开所在文件夹" | 文件夹打开 |
| A9 | 中等 PPT(50-200MB)| 不被 tooLarge 拦,正常 LibreOffice 转 PDF 预览 |

## 架构选型:4 层防御

### L1 — 统一入口闸门(P0,守门员)

`context/file.tsx` load() 加 size pre-check:调 Tauri 新命令 `get_file_size`,超 SIZE_LIMITS 设 `tooLarge` 标记跳过 sdk.client.file.read,UI 渲染 FileTooLarge 组件。

**只要这层守住,所有 viewer 都不会 OOM**。改动成本最低,投入产出比最高。

### L2 — 媒体类全部改走 `localasset://`(P0,根治视频/音频/图片)

video/audio/image 走 `<video|audio|img src="localasset://...">`,浏览器原生 HTTP Range 分片读。原 base64 链路(`read_binary_file_base64` → `base64ToBlob` → `URL.createObjectURL`)彻底拆除 — OOM 根源。

收益:1GB+ 视频秒开 + 支持 seek + 内存占用恒定。

**额外收益**:原"打开 .png 显示『图片不可预览』"bug 顺手修(图片此前 fileComponent 没正经 viewer)。

### L3 — 各 viewer 阈值兜底(P1)

| 分类 | 阈值 | 依据 |
|---|---|---|
| text / markdown / html | 10 MB | 对齐 `file-limits.ts MAX_EDITABLE_BYTES` + `HTML_PREVIEW_MAX_BYTES` |
| media | ∞ | localasset 分片读,N/A |
| binary | ∞ | backend 返空 content,N/A |
| office | **200 MB** | 2026-05-21 user 决议(原方案 50MB 偏小;LibreOffice 在 sidecar 异步转 PDF,webview 只拿引用,200MB 是常见 PPT 营销/教学 + sidecar 长任务负担之间的甜区)|
| default | 100 MB | 兜底未分类文件 |

### L4 — UX 兜底(P1)

新组件 `FileTooLarge`:
- 显示文件名 + size + 分类 + 阈值
- 2 按钮:**用本机软件打开** / **打开所在文件夹**(复用 `open_path` Tauri 命令)

## office 200MB 决策(本笔特别记录)

需求文档原方案 50MB,实施期 user 反问"是否过小,是否需要"。复盘:
- 文字 PPT 1-5MB ✅ / 含图 PPT 10-30MB ✅
- **营销/教学 PPT(高清图 + 嵌视频)50-200MB 常见**,会被误拦
- 极端营销大稿 500MB+ 偶有

OOM 风险其实比 text/markdown 小一个数量级:office 不直接读进 webview,LibreOffice 在 sidecar 进程转 PDF,前端先拿 `OFFICE_PDF_REF_MIME` 引用,真 PDF 字节通过 binary endpoint 按需 fetch。**主要代价是 sidecar 转换时间 + 临时内存**,不是 app 崩。

3 选项对比:
- A. 维持 50MB — 拦得过死,误拦 95% PPT
- **B. 提到 200MB**(采用) — 覆盖 95% PPT,极端大稿仍拦,sidecar 不会卡 10 分钟
- C. 不限(Infinity) — 信任 sidecar,但 500MB 大稿真有可能 hang 几分钟拖垮飞书桥接 / chat 等其他 plugin

**选 B**:给极端 case 留一道闸,sidecar 不被拖垮。

## R 合规预判

- **R2** FORK marker:Tauri 命令头注 / utils 头注 / 组件头注 / 修改点边界各处
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全在 fork 白名单:`packages/app/src/{context,components,pages,utils}` + `packages/desktop/src-tauri/src/{text_file,lib}`)
- **R5** Medium 规模:新功能必带测试(19 单测覆盖 file-size-guard helper)
- **R6** 不涉及网络监听
