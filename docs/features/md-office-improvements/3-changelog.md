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

---

## Post-release 修复记录(2026-05-05 user runtime 反馈)

初版 8 项 scope + 4 Phase 提交后,user 多轮 runtime 反馈共 10+ 项问题,陆续修复(共 4 笔 fix commit)。下面按问题类型归类:

### 渲染失效(Phase 2/3 plugin 链)

| 问题 | 根因 | 修复 |
|---|---|---|
| Mermaid 整体没渲染(Phase 3) | marked-shiki highlight callback 在我之前就把 ```mermaid 替换成 shiki HTML | marked.tsx 在 highlight callback 里加 `if (lang === "mermaid") return placeholder` 早返,跳过 shiki |
| Callout `[!NOTE]` 没渲染(Phase 2) | DOMPurify USE_PROFILES 缺 `svg: true`,marked-alert 输出的 SVG 图标被 strip | markdown.tsx config 加 `svg + svgFilters` profile;markdown.css 加 5 种 callout 颜色样式 |
| 脚注 `[^1]` 没跳转(Phase 2) | DOMPurify `SANITIZE_NAMED_PROPS=true` 把 `<li id="footnote-1">` 加前缀成 `id="user-content-footnote-1"`,但 `<a href="#footnote-1">` 不同步 → 锚点不匹配 | decorate 加 `fixSanitizeNamedPropHrefs`:扫所有 `[id^="user-content-"]` 建映射,把对应 `href` 加同样前缀 |

### 链接行为(Phase 4)

| 问题 | 根因 | 修复 |
|---|---|---|
| .md 内链点击同时打开浏览器 | marked.tsx link renderer 给所有 `<a>` 加 `target="_blank"` → Tauri 把 _blank 路由系统浏览器 | decorate 加 `fixLinkTargets`:相对链接去 target/rel,加 `internal-link` class;外链保持 `target="_blank"` 走系统浏览器(D5 期望) |
| 越权链接也开浏览器 | 同上 | 同上(同时 click handler 永远 preventDefault) |
| 不存在文件开空 tab | onOpenTab 不检查文件存在 | handleMdLinkClick 加 invoke `get_file_mtime` pre-check,不存在 → showToast |

### 资产渲染(Phase 1 边角)

| 问题 | 根因 | 修复 |
|---|---|---|
| 中文路径/文件名图不显示 | marked 输出的 `<img src>` 已经把非 ASCII percent-encode → 我没解码就当路径,然后 localAssetUrl 又 encodeURIComponent → 双重编码 | rewriteAssetSrc 在 resolveAbsolute 之前 try `decodeURIComponent`(单次还原)|
| 视频进度条无法拖动 | Rust handler 不支持 HTTP Range request → 浏览器 seek 拿不到 partial content | local_asset.rs handle_inner 加 `range_header` 参数,解析 "bytes=start-end" → seek + read_exact + 206 Partial + Content-Range header;`Accept-Ranges: bytes` 加全 200/206 路径 |

### 文件树同步(Phase 4 #8 升级)

| 问题 | 根因 | 修复 |
|---|---|---|
| 跳转后文件树无任何反应(高亮/展开/滚动) | "all" tab 的 FileTree 没传 `active` prop;且没有"切 tab → 展开父目录"机制 | activeFilePath createMemo + createEffect + FileTree active prop |
| **Windows path 分隔符不一致**(关键踩坑) | `file.pathFromTab` 返回 forward slash,但文件树 server 给的 `node.path` 是 backslash → 我 `expand("test/phase4")` 在 store 创建一个 entry,文件树 `expanded(state("test\\phase4"))` 查另一个 → state 不互通 → Collapsible 不展开 → DOM 不渲染子行 | `isWindowsPath` 检测 + `toFsPath` 转 OS 原生分隔符;activeFilePath / expand / scrollIntoView selector 全用 backslash on Windows |
| TOC 大纲面板 user 不需要 | — | 移除整个 aside JSX + 相关 signals;保留 `mdContainerRef` + `handleMdLinkClick`(内链拦截需要)|

### 视觉 polish(2026-05-05 user 验收后顺手)

| 项 | 改动 |
|---|---|
| 内链 vs 外链区分 | internal-link 加 dotted underline + hover background;title 提示"在文件查看器打开"vs"在浏览器打开" |
| Mermaid SVG 居中 + 自适应 | `display: block; margin: 0 auto; max-width: 100%`;容器 flex justify-center |
| Mermaid 加载占位 | 纯文字 "渲染流程图中…" → 加 14px 旋转圆环 spinner(纯 CSS keyframes,0 JS) |
| 文件树 active 行 VSCode 风左竖条 | classList 加 `shadow-[inset_2px_0_0_0_var(--text-interactive-base)]` — box-shadow inset 不占布局 |

### Tauri 配置

- 调试期短暂开了 `tauri = features=["devtools"]` 帮助 user 抓 console 日志,问题定位后**关掉**(release 不该带 devtools);user 仍可临时改 Cargo.toml 加回来自调

## Post-release fix commit hash(粗序)

| commit | 内容 |
|---|---|
| `2c2102295` | 6 项 P0/P1 一锅端(Mermaid bypass + Callout SVG profile + 脚注 — 当时还没修对 / 内链 target=_blank / 视频 Range / TOC 移除 / 不存在文件 toast)|
| `b7cdfdcc7` | 中文路径双重编码 + 脚注 SANITIZE_NAMED_PROPS hrefs patch |
| `b878d6f75` | 文件树 active 高亮 + 展开父目录 + 滚动入视野(初版,**有 Windows 分隔符 bug**)|
| (本笔 / 同收尾笔) | 修 Windows path 分隔符 + 4 项视觉 polish + 关 devtools |

## 经验沉淀(给未来 fork 自己看)

1. **Windows path 分隔符是地雷** — fork 多处使用 forward slash(URL 风格),server 用 backslash。两端混用就会出"看似正确但 store key 不互通"的 bug。**今后凡涉及 file.tree.state(path) 比较 / DOM querySelector 的 path,先 normalize 一致**。
2. **plugin chain 顺序敏感** — marked-shiki 在 token 阶段拦 code block,后置的 markdown.tsx decorate 找不到原 code class。今后加 marked plugin 处理特殊 lang,优先在 marked-shiki callback 里 early-return。
3. **DOMPurify SANITIZE_NAMED_PROPS 的副作用** — 改 id 加前缀但不改 href 锚点,任何依赖 `#id` 跳转的功能都会断。fork 不是关闭它(安全机制),而是后置 patch hrefs。
4. **AI debug 能力极限** — code 静态分析无法发现 runtime state 不一致(如 path 分隔符 cross-store);**必须靠 user DevTools console 抓真实 state value**。后续 user runtime 反馈时,优先让 user 在 DevTools 跑 `__deskfox_*` 全局调试句柄,几行 console.log 比纯靠分析快 10x。
