---
feat-id: md-office-improvements
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# Markdown 查看器办公场景综合优化

## 需求来源

`OPENCODE-PLAN/需求池/md-办公优化-综合论证.md`(2026-05-04 锁版)。

吸收以下需求池条目(全部归本笔):
- `md-预览-本地图渲染.md` → Phase 1 #1
- `文件引用跳转.md` v1(MD 链接 + 图)→ Phase 4 #8
- `md-viewer-frontmatter渲染.md` → Phase 2 #3
- `md-viewer-相对路径图.md` → Phase 1 #1(深度版同 md-预览-本地图渲染.md)
- `md-viewer-Mermaid图表.md` → Phase 3 #4
- `html-预览-渲染后样子.md` → Phase 1(共建 Tauri protocol)

(`文档内链接跳转.md` 在论证阶段已删 — 完全冗余于文件引用跳转)

## 背景:当前 MD viewer 已有能力(基线)

| 类别 | 能力 | 来源 |
|---|---|---|
| 基础语法 | H1-H6 / 段落 / 粗体 / 斜体 / 删除线 / 列表 / 编号列表 / 引用 / 水平线 | CommonMark |
| GFM 增强 | 表格 / 任务列表 `[x]` / 自动链接 / 围栏代码块 | marked GFM |
| 代码 | 全语言语法高亮(Shiki) + 一键复制按钮 + URL 自动识别 | `marked-shiki` + 仓内 decorate |
| 数学公式 | 行内 `$...$` + 块级 `$$...$$` | `marked-katex-extension` |
| 链接 | 外链 `target=_blank rel=noopener` | 仓内自定义 link renderer |
| HTML 嵌入 | `<details>` `<span>` `<div>` 等(白名单 + DOMPurify 净化 script/style) | DOMPurify |
| 排版 | 标题阶梯 / 引用块底色 / 行内代码芯片 / HR 显形 / 表头底色 | `md-viewer-typography` feat |
| 交互 | 选中文字右键加聊天 / 选区跨 shadow DOM 修复 / Ctrl+C 修复 | 4 笔 fork feat 累计 |

## Scope:本笔做 8 项 / 不做 7 项

### 做(分 4 Phase)

| Phase | # | 项 | 说明 |
|---|---|---|---|
| **1** | 1 | 本地相对路径图片 | `![](./img.png)` `![](../assets/x.png)` 解析 |
| **1** | 2 | 本地音频/视频内嵌 | `<video src="./demo.mp4">` 同 protocol |
| **1** | — | HTML 预览(共建 Tauri protocol) | `.html` 文件双向切换"预览/源码",iframe + sandbox |
| **2** | 3 | Frontmatter 隐藏(Obsidian 风) | `---\n...\n---` YAML 头默认完全隐藏 |
| **2** | 5 | Callout / Alert 块 | `> [!NOTE] xxx` `> [!WARNING] xxx` GitHub 风 |
| **2** | 6 | 脚注 | `[^1]` + `[^1]: 解释...` |
| **3** | 4 | Mermaid 流程图 | ```mermaid 代码块 → SVG 渲染,**runtime 0 网络** |
| **4** | 7 | TOC 常驻面板 | 右侧固定 outline,锚点平滑滚动(VS Code 风) |
| **4** | 8 | MD 内链跳转 | `[link](./other.md)` 点击在查看器打开,`resolve-path.ts` 共享 |

### 不做(留 backlog)

- 下划线 `<u>` / `==高亮==` / `~下标~` `^上标^`(自定义语法,非 CommonMark/GFM,频次不够高)
- Emoji `:smile:` 转换(现代 OS 输入法已能直接打)
- PlantUML / Graphviz / D2(比 Mermaid 小众一个数量级,PlantUML 还要 Java)
- Excalidraw / TLDraw 嵌入(Obsidian 特化)
- WikiLinks `[[]]` 双链(Obsidian 私有方言)
- 导出 PDF(独立需求,走文件树右键菜单更合理)
- 文件引用跳转 v2/v3 — 代码 `import` 识别(走 CodeMirror/Pierre 渲染层,技术路径不同)

## 决策(user 锁版 2026-05-04)

| 决策 | 答 | 实施影响 |
|---|---|---|
| **D1** | A | Phase 1 与 HTML 预览同期出库,共建 Tauri protocol(Rust 校验代码一份用三处) |
| **D2** | A | 一笔大 feat `feat/md-office-improvements`,内部分 Phase 提交 |
| **D3** | A + 镜像澄清 | Mermaid 动态加载;**runtime 0 网络请求**(纯本地 chunk read);user 担忧的"中国速度"指开发者 build time,与终端用户无关 |
| **D4** | C | TOC 面板**永远在**右侧(VS Code 风 outline);空 TOC 显示"(无标题)"或自动收起 |
| **D5** | Obsidian 风 | Frontmatter 默认**完全隐藏**;YAML 错容错降级为原文(不爆错) |

## 架构选型

### Phase 1 — Tauri 自定义 protocol

```
浏览器请求  tauri://local-asset/{absolute-path}
            ↓
Rust handler:
  1. URL 解析出 path
  2. canonicalize() 解 .. + 符号链接
  3. starts_with(sdk.directory.canonicalize()) 越权防护
  4. 通过 → 读字节 + Content-Type by extension
  5. 拒绝 → 404
            ↓
浏览器收到内容,渲染
```

**统一 protocol 服务三类资源**:
- `.md` 内 `<img>` `<video>` `<audio>`(本笔 #1 + #2)
- HTML 预览 iframe 内的 `<img>` `<link>` `<video>` 等(本笔 HTML 预览部分)
- 未来可扩展:CSS `url(...)`、`<a href="./other.md">` 跳转(若改走 protocol)

**前端 marked image renderer override** 把 `<img src="./foo.png">` 改写为 `<img src="tauri://local-asset/{absolute resolved path}">`,渲染时一次性算完(不依赖 runtime"当前 .md 路径"上下文,与切 tab 完全解耦)。

### Phase 2 — 三个 marked 扩展

- **Frontmatter**:用 `gray-matter` 或正则 strip,YAML 错容错降级显示原文
- **Callout**:`marked-alert` npm 包(轻量,GitHub 风)
- **脚注**:`marked-footnote` npm 包

### Phase 3 — Mermaid 动态加载

- 注册 marked codeblock renderer 拦 ` ```mermaid `
- 动态 `import('mermaid')` → vite 拆 chunk(冷启动 0 影响)
- 调用 mermaid API renderToSVG → 替换代码块为 SVG
- 加载失败容错:回退显示源码
- **runtime 0 网络请求**(changelog 会 explicit 标注)

### Phase 4 — TOC 常驻 + MD 内链

- 解析 marked heading,注入 `id` + 收集 outline tree
- 右侧 fixed 面板(可折叠收起)
- 点击平滑 `scrollIntoView({ behavior: 'smooth' })`
- MD 链接 `[x](./y.md)` → 拦截 click → 调 `openFile(resolved)` 在文件查看器打开
- `resolve-path.ts`:相对路径解析 + 越权防护(同 Phase 1 Rust handler 的安全策略)

## R1-R4 合规

| 规则 | 评估 |
|---|---|
| **R1**(三级跳) | 主要走第 1-2 档:fork-only 新文件(`resolve-path.ts` / Rust protocol handler 文件)+ 上游 ≤5 行接口注入(`tauri.conf.json` 加 protocol scheme);P1 隔离原则达成 |
| **R2**(FORK marker) | 改 `tauri.conf.json` / `marked.tsx` / `markdown.tsx` 等上游文件加 marker;新 fork 文件无需 marker |
| **R3**(品牌 / 主题 / icon hardcode) | 不触发 — protocol scheme 不是品牌字段 |
| **R4**(黑名单 override) | 评估改的所有上游文件 — `packages/desktop/src-tauri/tauri.conf.json` 在黑名单,**首次** R4 override 必要(无 wrapper 可替),需要明确论证;其余 `packages/app/`、`packages/ui/` 不在黑名单(本笔 fork 已大量改造区) |

## 工程量预估

| Phase | 工作量(人 / AI 辅助) |
|---|---|
| Phase 1 | 2.5d / **2-4 小时 AI 辅助** |
| Phase 2 | 1.3d / **1-2 小时** |
| Phase 3 | 1d / **1-2 小时** |
| Phase 4 | 2d / **2-3 小时** |
| **总** | 6.8d / **6-11 小时 AI 辅助** |

(实际可能挤几个会话搞定;每 Phase 一个 commit checkpoint)

## 验收标准(8 项 scope + 不回归)

### Phase 1
- [ ] A1.1:`.md` 内 `![](./img.png)` 同目录图正常显示
- [ ] A1.2:`.md` 内 `![](../assets/x.png)` 父目录图正常显示
- [ ] A1.3:`.md` 内 `![](./assets/x.png)` 子目录图正常显示
- [ ] A1.4:中文文件名 `![](./架构图.png)` 正常显示
- [ ] A1.5:`<video src="./demo.mp4">` 内嵌播放
- [ ] A1.6:路径越权 `![](../../../etc/passwd)` 返回 404
- [ ] A1.7:`.html` 默认显示渲染后样子,可切回源码
- [ ] A1.8:HTML 内 `<img src="./foo.png">` 正常加载
- [ ] A1.9:HTML 内 `<script>` 失活(sandbox 防护)

### Phase 2
- [ ] A2.1:Frontmatter `---\ntitle:x\n---` 完全隐藏(对齐 Obsidian)
- [ ] A2.2:YAML 语法错的 frontmatter 容错显示原文,不爆错
- [ ] A2.3:`> [!NOTE] xxx` 渲染为 GitHub 风 callout(图标 + 颜色)
- [ ] A2.4:`> [!WARNING]` `> [!TIP]` `> [!IMPORTANT]` `> [!CAUTION]` 五种 callout 全支持
- [ ] A2.5:脚注 `[^1]` `[^1]: 解释` 在底部生成脚注列表 + 点击跳转

### Phase 3
- [ ] A3.1:` ```mermaid \n graph TD\n A --> B \n``` ` 渲染为流程图
- [ ] A3.2:Mermaid 渲染失败(语法错)容错显示源码
- [ ] A3.3:首次加载 mermaid chunk 时**0 网络请求**(devtools Network 面板验证)
- [ ] A3.4:不含 mermaid 的 .md 不加载 mermaid chunk(冷启动 0 影响)

### Phase 4
- [ ] A4.1:长 .md(>3 H2/H3)右侧出现 TOC 面板
- [ ] A4.2:点击 TOC 项平滑滚动到对应 heading
- [ ] A4.3:短 .md(0 heading)TOC 自动收起或显示"(无标题)"
- [ ] A4.4:`[link](./other.md)` 点击在查看器打开 other.md
- [ ] A4.5:`[link](./missing.md)` 点击 toast"文件不存在"
- [ ] A4.6:`[link](../../../etc/passwd)` 路径越权拒绝

### 不回归
- [ ] R1.1:聊天侧 markdown 渲染不变(scoped 在 `data-context="file-viewer"` 外)
- [ ] R1.2:`.md` 现有功能(KaTeX / Shiki / 表格 / 任务列表 / 复制按钮)正常
- [ ] R1.3:typecheck 15/15
- [ ] R1.4:DeskFox.exe build 通过,体积增长 < 3MB(主要是 mermaid chunk)

## 风险

### R1 路径解析错误
- 当前 .md 在子目录,`![](./img.png)` 应解析子目录 + img.png(不是项目根)
- **缓解**:image renderer 接收当前 .md 绝对路径,前端 path.posix.resolve 规范化,Rust handler 同样校验

### R2 路径越权
- `![](../../../etc/passwd)` 试图偷文件
- **缓解**:**Rust handler 做最终防线**(canonicalize + starts_with sdk.directory),前端任何 rewrite 不可信

### R3 大图卡 WebView
- 朋友报告里塞 10MB PNG
- **缓解**:HTML 预览 2MB 阈值已有,图片单独阈值 5MB(待测)

### R4 marked image renderer hook 穿透
- `marked` renderer override API 稳定,但 `@opencode-ai/ui/markdown` 包了一层,需确认是否暴露 hook
- **缓解**:出库时 grep marked 实例 + 必要时补 props 钩子

### R5 Mermaid 渲染时机
- 动态 import 是 async,marked 解析完后异步替换 codeblock,可能闪一下"代码块 → SVG"
- **缓解**:占位骨架 + transition;或先渲染源码 placeholder,加载完替换

### R6 Frontmatter 误判
- `---` 在正文里也合法(分割线),不能盲目把头几行 strip
- **缓解**:严格匹配 `^---\n` 开头 + `\n---\n` 结尾的成对模式,且只在文件顶部(行号 < 5 或前面只有空行)

### R7 TOC 与现有右侧面板冲突
- DeskFox 右侧已有 sidepanel(file tree / agents / etc.),TOC 放哪
- **缓解**:实施时勘察现有 layout,可能需要在 file viewer 内嵌 TOC(右侧 contained,不动 outer side panel)

## 关联代码定位

- `packages/app/src/pages/session/file-tabs.tsx` — 渲染分发主入口
- `packages/ui/src/components/markdown.tsx` — `<Markdown>` 组件实现
- `packages/ui/src/context/marked.tsx` — marked 实例 + 现有插件
- `packages/desktop/src-tauri/tauri.conf.json` — 注册 protocol scheme(R4 候选)
- `packages/desktop/src-tauri/src/lib.rs` — Rust builder + commands 注册(本次加 protocol handler)
- `packages/app/src/utils/file-limits.ts` — 大文件门槛参考

## 决策签字

- **2026-05-04**:user 答 D1=A / D2=A / D3=A(+镜像澄清)/ D4=C / D5=Obsidian 风 → spec 锁版
- **后续**:实施期间任何 scope 偏移在 `2-plan.md` 实时追加 note,不偷偷扩
