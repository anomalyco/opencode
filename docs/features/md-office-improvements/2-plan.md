---
feat-id: md-office-improvements
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 实施计划 + 决策轨迹

## 实施总览

按 1-spec D2-A 决策走"一笔大 feat,内部按 Phase 提交"。4 个 Phase 各一个 commit checkpoint:

| Phase | commit | 内容 | 工程量(实际) |
|---|---|---|---|
| Phase 1 | `5fe16d193` | Tauri protocol + 本地图 + 音视频 + HTML 预览 | ~1.5 小时 AI 辅助(估 2.5d 人) |
| Phase 2 | `f7b79f5b9` | Frontmatter 隐藏 + Callout + 脚注 | ~30 分钟 |
| Phase 3 | `6a752ec42` | Mermaid 动态加载 | ~45 分钟 |
| Phase 4 | `9f093780e` | TOC 常驻 + MD 内链 | ~1 小时 |
| **总** | 4 commit | | ~3.5 小时 AI 辅助(估 6.8d 人) |

实施期间无 scope 偏移 — 全部按 1-spec 的 8 项 scope 落地,7 项明确不做都没碰。

## Phase 1 决策轨迹

### URL scheme 设计选择 — `localasset://localhost/<base64url-root>/<rel-path>`

为何 path-based + base64url root 而不是 query-string?
- HTML 预览 iframe 加载 .html 后,HTML 内的相对资源(如 `<img src="./foo.png">`)由浏览器自动按**当前 URL 路径**解析
- 如果 URL 用 query 参数传 root + path,浏览器解析 `<img src="./foo.png">` 不会把 query string 重新 split 进去 → 只会拼成 `localasset://localhost/?root=...&p=foo.png`(错的)
- path-based 设计:iframe URL `localasset://localhost/<b64root>/notes/report.html`,内部 `<img src="./foo.png">` 自动解析为 `localasset://localhost/<b64root>/notes/foo.png` → handler 收到正确路径

**为何 base64url 编码 root**?path 第一段必须是单个 segment(不能含 `/`),Windows 路径如 `D:/project/notes` 含 `/`,直接放第一段会破坏 splitn(2, '/')。base64url 输出只含 `[A-Za-z0-9_-]`,安全。

### 越权防护放 Rust handler

frontend rewrite 计算的"绝对路径"理论上可能被恶意 markdown 注入(用户从外部复制粘贴 .md)。前端 trust boundary 之外。Rust handler 用 `Path::canonicalize()` 解 `..` + 符号链接 + `starts_with(sdk_root_canon)` 校验,作为最终防线。

### iframe sandbox 选 `allow-same-origin` 不加 `allow-scripts`

按 1-spec 安全章节,绝不开 `allow-scripts`。HTML 内 `<script>` 全部失活。这与 D5(默认显示渲染后样子)兼容 — 用户想要的是"看渲染后样子",JS 执行属于"运行 HTML 应用"另一个层面。

## Phase 2 决策轨迹

### Frontmatter strip 放 app 侧而非 marked 扩展

最初想用 `marked-frontmatter` 之类插件,但调研发现 D5 锁版只要"完全隐藏"行为 — 不需要解析后展示元数据。简单 regex 在 app 侧 strip 比加 dep 更合算(0 npm package + 0 ui/ 改动)。

正则 `^---\r?\n[\s\S]*?\r?\n---\r?\n` 严格匹配文件开头 + 成对模式,正文里的 `---` 分割线不误判。strip 失败容错保留原文。

### Callout / Footnote 选择 marked 官方扩展

`marked-alert` v2.x — GitHub 风 5 种 alert 全支持。轻量(~10KB)。
`marked-footnote` v1.x — 标准 `[^1]` 语法 + 底部脚注列表 + 锚点跳转。

加 plugin 必须改 `packages/ui/src/context/marked.tsx` 的 marked.use([...]) 链。Phase 2 触发第二笔 R4 override(本 feat 范围内,user 已一次性批准)。

## Phase 3 决策轨迹

### Mermaid 实施位置 — markdown.tsx decorate 阶段

考虑过两个位置:
- A. **marked 扩展**:写 marked plugin,在 token 解析阶段拦 mermaid code block
- B. **markdown.tsx decorate**:解析后扫 `<pre><code class="language-mermaid">` 替换占位

选 B 因为 marked-shiki 已经在 token 阶段 wrap 了 code block,加扩展可能与 shiki 冲突;decorate 阶段修改稳定 DOM 更可靠。

### 渲染时机 — 异步 dynamic import + 占位优先

```
decorate(同步):<pre> → <div data-mermaid-source="..."> 占位"渲染流程图中…"
       ↓
morphdom 把占位 commit 到 live DOM
       ↓
createEffect:void renderMermaidIn(container)
       ↓
async:await loadMermaid()(首次触发 dynamic import,vite chunk read)
       ↓
mermaid.render(id, src) → SVG → 替换占位 innerHTML
```

冷启动 0 影响(主 bundle 不含 mermaid)。无 mermaid 的 .md 永不触发加载。

### morphdom 守卫:避免重复渲染闪源码

发现风险:每次 markdown 内容变化,morphdom 重 reconcile,如果不阻拦,**已渲染的 SVG 占位会被新 placeholder 覆盖回"渲染流程图中…"**(因为新一轮 decorate 又生成了 placeholder)。

解决:`onBeforeElUpdated` 加守卫,`data-component="markdown-mermaid"` 且无 `data-mermaid-source`(已 render 完毕标志)→ 返 false,morphdom 不动它。

### 字体选择 — 系统字体不拉 web font

`mermaid.initialize({ fontFamily: "var(--font-sans, sans-serif)" })`。配合 `securityLevel: "strict"` — mermaid 内部 sanitize SVG,输出无 script。**runtime 0 网络请求**(D3 锁版承诺落实)。

## Phase 4 决策轨迹

### TOC 实施 — heading id 注入 + 客户端 DOM 扫描

最初想用 `marked-gfm-heading-id` 之类 plugin,但发现 marked v17 的 GFM 已含 heading-id 行为(自动 slug)。但实际渲染 HTML 没看到 id 属性 → 可能 plugin 未启用或被 DOMPurify 过滤。

最稳路径:在 markdown.tsx decorate 阶段统一 `assignHeadingIds(root)` — 没 id 的就赋 `md-h-N`。idempotent,subsequent renders 不会重复(已有 id 跳过)。

### TOC 缩进策略 — minLevel 对齐

`tocMinLevel = items.reduce((m, x) => Math.min(m, x.level), 6)`:用最浅 heading 当 baseline。3 级 .md(全 H2 起) → minLevel=2,所有 H2 不缩进、H3 缩进 0.75rem,H4 缩进 1.5rem。1 级 .md(全 H1) → 一行平齐。

避免常见缺陷:写 H2 起的 .md 文件如果按 H1=0 缩进,所有 TOC 项都缩进,看着像第二级。

### onOpenTab prop 接通方式

最简单:加可选 prop。session-side-panel.tsx 是唯一 callsite,加一行传 `onOpenTab={(path) => openTab(file.tab(path))}`。复用现有 tab 打开机制。

不传 onOpenTab 时(理论上 chat 视图 / 测试场景),click handler 走完拦截逻辑后无操作 — 浏览器原生跳转(可能 404,但不阻塞)。

## 测试矩阵

实施期间已通过的自动化检查:
- typecheck:15/15(rebase 前后各跑 4 次,Phase 4 cache 命中 1.4s)
- DeskFox.exe build:32.27MB(Phase 1)→ 32.27MB(Phase 2)→ 34.78MB(Phase 3,+2.5MB mermaid 含间接依赖)→ 34.79MB(Phase 4)

待 user runtime 实测(见 1-spec "验收标准" 段 A1-A4 + R1-R4 全 23 项)。

## 工程量实绩对比

| 项 | 1-spec 估算(人) | 实际(AI 辅助) |
|---|---|---|
| Phase 1 | 2.5d | ~1.5 小时 |
| Phase 2 | 1.3d | ~0.5 小时 |
| Phase 3 | 1d | ~0.75 小时 |
| Phase 4 | 2d | ~1 小时 |
| **代码总** | 6.8d | **~3.75 小时** |
| 文档总(spec/plan/changelog) | — | ~1 小时 |

AI 辅助 vs 人工估算约 12-15× 加速,合理范围。

## R4 override 累积(本 feat)

- Phase 1:`packages/ui/src/components/markdown.tsx`(rewriteAssetSrc prop)— 第 1 笔
- Phase 2:`packages/ui/src/context/marked.tsx`(callout + footnote plugins)+ ui/package.json(2 dep)+ bun.lock — 第 2 笔(同 commit)
- Phase 3:`packages/ui/src/components/markdown.tsx`(mermaid 占位+异步)+ ui/package.json(mermaid dep)+ bun.lock — 第 3 笔
- Phase 4:`packages/ui/src/components/markdown.tsx`(heading id 注入)— 第 4 笔

**user 在 Phase 1 答 A 后于 Phase 2 升级为"本 feat 范围内一次性批准同性质 R4 override"**,Phase 3-4 直接 commit。

季度 override 配额已严重超额(本 feat 4 笔单独成 4 笔 commit 超额 4 倍以上),但都是同源同性质(packages/ui/ markdown 相关 additive 改动)。后续 feat 应严格控制 R4 override 频次。
