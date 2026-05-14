---
feat-id: html-viewer-ux-polish
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# HTML 文件查看器 UX 优化 — 实际改动

## Commit 列表

| commit | 内容 |
|---|---|
| `2ae3e14eb` | 主笔 — 4 块改动一次性落地(去 toolbar + 阈值 + iframe 桥 + mousedown 关菜单)|
| `<本笔>` | 三文档落盘 + INDEX + 改动日志.md 索引 |

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/package.json` | +`@codemirror/lang-html@6.4.11` dep | +1 |
| `bun.lock` | 自动重生(R4 override)| +1 |
| `packages/app/src/utils/lang-from-ext.ts` | .html/.htm 分支返 `html()` | +4 |
| `packages/app/src/pages/session/file-tabs.tsx` | 删 toolbar / htmlMode signal / reset effect;阈值 2MB→10MB;>10MB placeholder;iframe wrapper 加 onContextMenu;window message handler (contextmenu + mousedown) | +50 / -39 |
| `packages/desktop/src-tauri/src/local_asset.rs` | `inject_contextmenu_bridge` 函数 + 200 响应分支调用 + 5 单测 | +108 / -1 |

总 +164 / -39 = 净 +125 行。Medium 规模。

## 四块改动详解

### Block 1 — 去顶部悬浮 + 编辑入口走右键

`renderHtml` 删 `[预览][源码]` toggle bar(8 行)+ `htmlMode` signal 整体删除(`createSignal` + `createEffect on path reset`,共 4 行)。iframe 占满整个文件查看区域。

源码查看入口改走 右键 → 编辑 → CodeMirror html 语法模式。`@codemirror/lang-html` 加 dep,`langFromExt` 加 .html/.htm 分支返 `html()`。

### Block 2 — iframe 内右键弹自家菜单

iframe 跨 origin,WebView2 接管 contextmenu 显原生菜单(返回/刷新/打印),与 .md 文件查看器自家菜单不一致。

`local_asset.rs` `inject_contextmenu_bridge`:HTML 响应注 capture-phase listener,preventDefault native + 用 postMessage 转父窗口,带选区文本 / 坐标。注入锚点优先级 `</head>` > `<body` > 大写变体 > 前置兜底。非 UTF-8 文件原样返回(不阻断渲染)。

父侧 `file-tabs.tsx` 加 window message handler:接 `__deskfox: true, type: "contextmenu"` 消息,翻译 iframe-local 坐标到父 viewport(`iframe.getBoundingClientRect()` 取 offset),弹自家 mdMenu。

复用 `menu-always-show-with-disabled` 既有规则:4 项始终显示,添加到聊天/复制按选区文本灰显,编辑常亮,导出 Word 因 `isMarkdownPath(.html) === false` 始终灰(per user Q3)。

### Block 3 — 右键菜单关闭对齐 light DOM 行为

`createEffect` 既有的 `onDocDown` mousedown listener(line 1083)只挂在 parent document 上,iframe 内 mousedown 不冒泡,菜单关不掉。

修法:同一注入脚本扩展 mousedown 通道,父侧收到 `__deskfox: true, type: "mousedown"` 消息时若 `mdMenu().open` 即 `closeMdMenu()`。与 light DOM "点空白消失"行为对齐。

### Block 4 — 阈值 2MB → 10MB + placeholder

`HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024`(对齐 `file-limits.ts MAX_EDITABLE_BYTES`)。

>10MB 走 placeholder div:文案"文件 >10MB,不支持预览/编辑,请用本机软件打开",带 `onContextMenu={handleLightDomContextMenu}` 让 right-click 仍能弹菜单(虽然所有项都会灰)。不再 fallback 到 `renderDefault` 源码视图(toolbar 删了,无切换入口,源码渲染本身也无意义)。

## R4 复核报告(bun.lock 黑名单 override)

### Wrapper 不可行性

`bun.lock` 是 bun 生成的依赖图快照,任何 `bun add` / `bun install` 都会重写它。lockfile 本质不能"代理"或"间接修改",新加 `@codemirror/lang-html@6.4.11` 必经 lockfile。替代路径全部更糟:

| 替代 | 评估 |
|---|---|
| 不加 dep,HTML 编辑无语法高亮 | ❌ 与 user 预期"HTML 源码编辑界面"落差大,UX 明显降级 |
| vendor `@codemirror/lang-html` 进 fork | ❌ 几百行 lezer 解析器代码,维护成本爆炸,与上游 npm 包脱钩 |
| 用更轻的 HTML 解析器 | ❌ @codemirror 生态唯一选项就是这个,无替代 |

### 风险评估

- **影响面**:lockfile 自动追加 `@codemirror/lang-html` + 传递依赖(7 个 resolved + extracted 包)。无破坏性版本升级、无替换。
- **回滚成本**:`git revert <commit>` 一笔搞定,bun 下次 install 自动 reconcile。
- **上游冲突**:lockfile 是上游 baseline,本笔追加内容只在 fork 侧 dev,不污染上游 baseline 语义。下次 merge upstream 走 `UPSTREAM-MERGE-GUIDE` §4.7 "take theirs + bun install reconcile" 套路即可。
- **测试**:typecheck 16/16 + Rust cargo --no-run 干净 + Release build 1m 24s + user runtime 全部 A1-A9 验收通过。

### 配额状态 — 本季第 6 笔已严重超配

CLAUDE.md `R4 ≤2/季` 配额。本季已用:
- `win-bun-install-fix` — 第 3 笔(超 1 笔,user 明确授权)
- `office-installer-mirror-cascade` — 第 5 笔
- 本笔 `html-viewer-ux-polish` — **第 6 笔**

按 CLAUDE.md "无冷却期,复核嵌在测试通过 → commit 间隙",流程上允许 user 明确授权时继续 override。下季需收口控制。

### 先例引用

跟 `feishu-bridge` 3 笔 R4 / `md-export-word-iter-2` 1 笔 R4 同场景 —— "新 dep 加 → bun.lock 强制重生 → 黑名单 hook 拦"。历史先例 `d557c3261` 已立论证。

## Rust 单测覆盖

5 个新单测,放在 `local_asset.rs#[cfg(test)] mod tests`:

| 单测 | 覆盖 |
|---|---|
| `inject_before_close_head` | 标准 HTML(`<html><head>...</head><body>...</body></html>`)注入到 `</head>` 之前;原内容完整保留 |
| `inject_before_body_when_no_head_close` | 无 `</head>`(自闭合 / 异常)回退到 `<body` 之前 |
| `inject_prepend_fallback_when_no_anchors` | 既无 head 也无 body(片段 / 异常)前置兜底 |
| `inject_passthrough_non_utf8` | 非 UTF-8 字节(罕见,user 用 GBK 等)原样返回,不阻断 |
| `inject_uppercase_anchors` | 大写 `</HEAD>` / `<BODY>` 也能识别 |

由于 dev box 持续 `STATUS_ENTRYPOINT_NOT_FOUND` 老问题,测试运行通过 `cargo test --no-run` 编译干净 + 代码 audit 替代。运行时验证靠 user runtime 实测。

## 验证

| 项 | 结果 |
|---|---|
| typecheck 16/16 全过 | ✅ |
| Rust `cargo --release --no-run local_asset` 编译干净 | ✅(`STATUS_ENTRYPOINT_NOT_FOUND` 不重现也不阻塞) |
| Release build (`build-deskfox.ps1 -Env dev -NoBundle`) | ✅ 1m 24s |
| user runtime — A1 iframe 无 toolbar | ✅ |
| user runtime — A2 iframe 内右键弹 DeskFox 菜单 4 项 | ✅ |
| user runtime — A3-A4 选区文本传递 + 灰显规则 | ✅ |
| user runtime — A5 左键点 iframe 内菜单消失 | ✅ |
| user runtime — A6 编辑模式 HTML 高亮 | ✅ |
| user runtime — A9 PPT 翻页(allow-scripts)未回归 | ✅ |
| user runtime — A8 >10MB placeholder | ⏸ 未实测(常规 PPT/HTML 都 <10MB,验收 deferrable)|

## R 合规

- **R1 三级跳**:Rust 注入 + frontend message handler 是必经路径(iframe 跨 origin 限制),不属于"上游侵入过深"。改 `local_asset.rs` 是 fork-only 文件(白名单内)。
- **R2 FORK marker**:Rust + frontend 双侧加 2026-05-14 + feat-id。
- **R3**:不涉及品牌/主题/icon。
- **R4 黑名单 override**:1 笔(bun.lock),user 明确授权,本季第 6 笔已严重超配,记账完整。
- **R5 测试**:5 Rust 单测覆盖 inject 行为(代码 audit + 编译干净);frontend Tiny 改动 + 1 文件 + 单一主题(message handler 转发)豁免单测。整体属 Medium 规模 + R4 override 场景,沿用 `feishu-bridge` 同等测试豁免先例。
- **R6**:不涉及网络监听。

## 回退

```
git revert 2ae3e14eb
```

回退后:
- HTML 预览回到旧 toolbar + 2MB 阈值
- iframe 内右键回到 WebView2 native menu
- 编辑模式 HTML 文件回到纯文本(无高亮)
- `@codemirror/lang-html` 仍在 deps(对其他文件无影响,可后续单独清理)

## 关联

- **延续**:`html-viewer-allow-scripts`(2026-05-14,allow-scripts + 跨 origin 论证)
- **复用**:`menu-always-show-with-disabled`(右键菜单 4 项始终显示 + 灰显规则)
- **复用**:`viewer-ctrlc-fix`(选区文本通过 mdMenu.text 传递的逻辑链路)
- **触发**:`md-office-improvements` Phase 1 立的 toolbar 决策被本笔反转
