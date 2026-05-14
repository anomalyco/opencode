---
feat-id: html-viewer-ux-polish
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# HTML 文件查看器 UX 优化 — 实施计划

## 实施顺序

| Phase | 内容 | 工程量 |
|---|---|---|
| 1 | 删 toolbar + htmlMode signal + reset effect;阈值 2MB→10MB + placeholder | ~40 行 |
| 2 | `@codemirror/lang-html` 加 dep + `langFromExt` 接 .html/.htm | ~6 行 + 1 dep |
| 3 | Rust `local_asset.rs` 注 contextmenu 桥(preventDefault native + postMessage) + 5 单测 | ~80 行 |
| 4 | 父侧 `file-tabs.tsx` 加 window message handler + 翻译 iframe-local 坐标 → 弹 mdMenu | ~25 行 |
| 5 | follow-up:扩展桥脚本加 mousedown 通道修"左键点 iframe 内菜单不消失" | ~5 行 Rust + ~3 行 TS |

总 ~164 行代码 + 5 单测,Medium 规模。

## 决策轨迹

### D1 — 阈值 2MB → 10MB

user Q1 拍板。原 2MB 是 `md-office-improvements` Phase 1 写死的过保守阈值,user 反馈 PPT/Slides 常 >2MB(讲师版含图片 / SVG 内嵌)。改成 10MB,**与 `MAX_EDITABLE_BYTES` 对齐**:预览 + 编辑同卡 10MB 阈值,概念一致。

>10MB 走 placeholder("文件 >10MB,不支持预览/编辑,请用本机软件打开"),不再 fallback 到源码视图 —— toolbar 已删,无切换回预览入口,源码 fallback 也无意义。

### D2 — 右键菜单跟 MD 一致(选区文本一并传)

user Q2 拍板。iframe 跨 origin,parent 抓不到 iframe 内右键事件,WebView2 显原生菜单。

技术路径选 **Rust handler 注 contextmenu 桥** + **postMessage 传 x/y/选区文本** 给父窗口。父侧弹自家 mdMenu,4 项行为完全复用 .md 既有逻辑:`menu-always-show-with-disabled` 的"始终显示 + 选区文本 trim 灰显"规则自然适用。

选区文本通过 `window.getSelection()?.toString()` 在 iframe 内取后随 postMessage 传父,父侧把它 setMdMenu 的 text 字段 — `mdMenu().text.trim()` 不空 → 添加到聊天/复制 enabled。

### D3 — "导出为 Word"在 .html 上灰显

user Q3 拍板。HTML → Word 链路存在(HTML → markdown → docx)但要新写,留 backlog。当前规则 `disabled={!isMarkdownPath(path())}` 已自动让 .html 灰显,0 改动。

### D4 — 搜索功能不做(接受 WebView2 native Ctrl+F)

user 实测 `html-viewer-ux-polish` v1 后追问搜索框位置 —— 那是 WebView2 chrome 级控件,位置写死(window 顶部),改不了。备选方案:

| 方案 | 工作量 | 评估 |
|---|---|---|
| 自家搜索条 + postMessage 桥 | Medium(~150 行)| 完整体验但工程量大 |
| 复用 @codemirror/search(右键 → 编辑 → Ctrl+F) | 0 行 | 多一步切编辑模式,UX 心智成本 |
| 接受 WebView2 原生搜索条 | 0 行 | ✅ 选定 — user 明确 OK |

### D5 — `@codemirror/lang-html` 新依赖 → R4 第 6 笔本季

加 dep 必触发 `bun.lock` 自动重生,黑名单 hook 拦。wrapper 替代不可行(lockfile 本质不能"代理"),user 明确授权 R4 override。

跟 `feishu-bridge` 3 笔 / `md-export-word-iter-2` 1 笔 / `release-mac-ci` 等 R4 同等场景,论证沉淀已成形,本笔直接引用。

### D6 — mousedown 通道追加(follow-up)

v1 注入脚本只有 contextmenu listener。user 实测发现右键菜单弹出后,左键点 iframe 内部不能关菜单(parent 的 `onDocDown` mousedown listener 抓不到 iframe 内事件,跟 contextmenu 同根因)。

修法:同一注入脚本扩展 mousedown 通道,父侧收到 mousedown 消息时若 mdMenu open 即 closeMdMenu。改动 ~15 行,跟 contextmenu 桥同源同套路,零回归风险。

## 踩坑

### cargo test `STATUS_ENTRYPOINT_NOT_FOUND` 持续

dev box 环境性 ABI 问题,从 `imbot-permission-pragmatic` / `imbot-permission-minimal` 开始就有,跟本笔无关。

退路:跑 `cargo test --no-run` 确认测试代码编译干净,运行时验证靠 user runtime 实测代替 cargo runner。memory `reference_*` 没立条,先在本 plan 留底待积累更多 case 再判是否要立。

### pre-commit hook 拦 bun.lock

预期内,触发 R4 流程。出复核报告(wrapper 不可行 / 风险评估 / 改动日志论证)→ user 拍板 → `--no-verify` commit。详见 changelog "R4 复核报告" 段。

## 验证矩阵

| 项 | 状态 |
|---|---|
| typecheck 16/16 | ✅ |
| Rust cargo --no-run | ✅ 编译干净 |
| Rust 5 单测覆盖(head 锚点 / body 兜底 / 前置兜底 / non-UTF-8 / 大写锚点) | ✅ 代码 audit + 编译干净 |
| Release build (`build-deskfox.ps1 -Env dev -NoBundle`) | ✅ 1m 24s |
| user runtime — 9 项 A1-A9 全过 | ✅ user 2026-05-14 实测 |
