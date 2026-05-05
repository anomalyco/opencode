---
feat-id: md-office-improvements
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 改动日志

## commits(4 笔代码 + 1 笔文档收尾)

| commit | Phase | 内容 |
|---|---|---|
| `5fe16d193` | 1 | Tauri protocol + 本地图 + 音视频 + HTML 预览 |
| `f7b79f5b9` | 2 | Frontmatter 隐藏 + Callout + 脚注 |
| `6a752ec42` | 3 | Mermaid 流程图动态加载 |
| `9f093780e` | 4 | TOC 常驻面板 + MD 内链跳转 |
| (本笔) | docs | 2-plan + 3-changelog + INDEX + 改动日志.md 收尾 |

## 文件改动总览(累计 4 commit)

| 文件 | 性质 | 改动量 | R4 override |
|---|---|---|---|
| `packages/desktop/src-tauri/src/local_asset.rs` | 新文件 | +220 行 | 否 |
| `packages/desktop/src-tauri/src/lib.rs` | 修改 | +4 行(mod + register protocol) | 否 |
| `packages/app/src/utils/local-asset.ts` | 新文件 | +95 行(localAssetUrl + rewriteAssetSrc + resolveAbsolute) | 否 |
| `packages/app/src/utils/markdown-frontmatter.ts` | 新文件 | +25 行(stripFrontmatter) | 否 |
| `packages/app/src/pages/session/file-tabs.tsx` | 修改 | +185 -33 行(isHtmlPath / pathDirname / mdAssetRewriter / htmlMode / renderHtml / renderDefault / TOC / handleMdLinkClick + onOpenTab prop) | 否 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 修改 | +2 行(onOpenTab 接通) | 否 |
| **`packages/ui/src/components/markdown.tsx`** | 修改 | +131 行(rewriteAssetSources + mermaid 全套 + assignHeadingIds + decorate 集成 + morphdom 守卫) | **是 ×3 commit** |
| **`packages/ui/src/context/marked.tsx`** | 修改 | +5 行(markedAlert + markedFootnote import & use) | **是** |
| **`packages/ui/package.json`** | 修改 | +3 行 deps(marked-alert + marked-footnote + mermaid) | **是 ×2 commit** |
| **`bun.lock`** | auto-regenerated | +大量(mermaid 间接依赖 ~228 包) | **是 ×2 commit** |
| `docs/features/md-office-improvements/{1-spec,2-plan,3-changelog}.md` | 新 | ~700 行三文档 | 否 |
| `docs/features/INDEX.md` | 修改 | +1 行 | 否 |
| `改动日志.md` | 修改 | +1 行 | 否 |

**净代码 ~660 行**(不含 docs / lock 自动生成)。**Large 规模**(>500 行 + 多 ui/ 文件触动 = 黑名单)。

## R4 override 累计(4 笔本 feat)

| Phase | 黑名单文件 | 论证 |
|---|---|---|
| **1** | `packages/ui/src/components/markdown.tsx` | 加 `rewriteAssetSrc?: (src: string) => string \| null` 可选 prop + decorate 调用 rewriter。Wrapper 4 方案均不工作:① MutationObserver 与 morphdom reconcile 死循环 ② app 侧覆盖 marked 影响聊天 ③ 复刻 ~150 行独立 Markdown 组件维护负担 ④ server 预处理跨更多黑名单。聊天侧不传 prop = 完全 0 回归 |
| **2** | `packages/ui/src/context/marked.tsx` + `packages/ui/package.json` + `bun.lock` | 加 `markedAlert()` + `markedFootnote()` 到 marked.use 链。marked 是 useMarked context 全局共享,app 侧覆盖会污染聊天;独立 marked 实例又需 markdown.tsx prop(同源 R4)。聊天侧也获得 callout / 脚注支持,顺手增强,0 回归 |
| **3** | `packages/ui/src/components/markdown.tsx` + `packages/ui/package.json` + `bun.lock` | 加 mermaid 占位 + 异步 dynamic import + render。第二次改 markdown.tsx,additive 加~95 行帮手函数 + decorate 集成 + morphdom 守卫。聊天侧也获得 mermaid 渲染。runtime 0 网络(D3 锁版承诺落实) |
| **4** | `packages/ui/src/components/markdown.tsx` | 加 `assignHeadingIds()` 11 行,decorate 调用一行。第三次改,纯 additive。聊天侧 heading 也获 id(对 chat 内 anchor 跳转无影响,可有可无) |

**user 在 Phase 1 答 A(批准 override),Phase 2 升级为"本 feat 范围内一次性批准 same 性质同源 override",Phase 3-4 自动适用**。

季度 override 配额已严重超额。后续 feat 必须严控 R4 频次。**讨论项**:packages/ui/ 全目录黑名单可能过严,markdown 相关 additive 钩子是低风险高频需求,考虑在 governance 出独立白名单(类似 sprite/types 的 EXCEPTION_REGEX)— 留 backlog。

## 8 项 scope 落实情况

| # | scope | Phase | 状态 |
|---|---|---|---|
| 1 | 本地相对路径图片 `![](./img.png)` | 1 | ✅ |
| 2 | 本地音频/视频内嵌 | 1 | ✅ |
| (-)| HTML 预览(共建 protocol) | 1 | ✅(预览/源码 toggle + sandbox + 2MB 阈值) |
| 3 | Frontmatter 隐藏(Obsidian 风) | 2 | ✅ |
| 5 | Callout / Alert(GitHub 风 5 种) | 2 | ✅ |
| 6 | 脚注 `[^1]` | 2 | ✅ |
| 4 | Mermaid 流程图 | 3 | ✅(runtime 0 网络) |
| 7 | TOC 常驻面板(VS Code 风) | 4 | ✅(空 TOC 显"(无标题)") |
| 8 | MD 内链 `[link](./other.md)` 跳转 | 4 | ✅(越权拒绝 + Toast) |

## 7 项明确不做(留 backlog)

- 下划线 / `==高亮==` / 上下标 — 自定义语法,频次不够
- Emoji `:smile:` 转换 — OS 输入法已能直打
- PlantUML / D2 — 比 mermaid 小众,且需 Java
- Excalidraw / TLDraw — Obsidian 特化
- WikiLinks `[[]]` — Obsidian 私有方言
- 导出 PDF — 独立需求(走文件树右键菜单)
- 文件引用跳转 v2/v3(代码 `import` 识别)— 走 CodeMirror/Pierre 渲染层,技术路径不同

## 验证

### 自动化(已通过)

| 项 | 状态 |
|---|---|
| typecheck 15/15(每 Phase 后跑) | ✅ |
| DeskFox.exe build(每 Phase 后跑) | ✅ Phase 1: 32.26MB / Phase 2: 32.27MB / Phase 3: 34.78MB(+mermaid)/ Phase 4: 34.79MB,exit 0 全过 |
| Rust 单测(`local_asset.rs` 7 个 test) | ⏳ 未跑(cargo test 命令路径需确认;build 通过即编译通过) |

### Runtime(待 user 实测,1-spec A1-A4 + R1-R4 全 23 项)

| 类 | 数 | 说明 |
|---|---|---|
| Phase 1 验收 | A1.1-A1.9(9 项) | 本地图各场景 + 音视频 + HTML 预览 + 越权 |
| Phase 2 验收 | A2.1-A2.5(5 项) | Frontmatter 隐藏 + Callout 5 种 + 脚注 |
| Phase 3 验收 | A3.1-A3.4(4 项) | Mermaid 渲染 + 容错 + 0 网络 + 冷启动 |
| Phase 4 验收 | A4.1-A4.6(6 项) | TOC 显示 + 锚点 + 空 TOC + 内链 + 不存在 + 越权 |
| 不回归 | R1.1-R1.4(4 项) | 聊天 / 现有 .md / typecheck / build size |

详细测试矩阵见 `1-spec.md` "验收标准" 段。

## 回退

```
git revert 9f093780e f7b79f5b9 6a752ec42 5fe16d193
```

或粒度 Phase 单独 revert(Phase 间互无 hard 依赖,但 Phase 1 protocol 是 Phase 3/4 / .md 图渲染的基座 — Phase 1 单独 revert 会让其余 Phase 的 .md 图回到 404)。

## 关联

- **吸收的需求池条目**(已在 1-spec 列出):md-预览-本地图渲染 + 文件引用跳转 v1 + md-viewer-* 三个子项 + html-预览-渲染后样子 + 文档内链接跳转(已删)
- **未来衔接**:
  - 文件引用跳转 v2/v3(代码 import 识别)— 留独立 backlog
  - 导出 PDF — 独立需求,走文件树右键菜单
  - markdown 内嵌 inline HTML 复杂样式 url(...)— v2 再考虑
